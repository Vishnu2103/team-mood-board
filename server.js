const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enable CORS
app.use(cors({
  origin: '*', // Be more restrictive in production
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'build')));

const wss = new WebSocket.Server({ 
  server,
  // Remove any path restriction
  path: '/',
  // Add error handling
  clientTracking: true,
  handleProtocols: () => true
});

// Store rooms and their data
const rooms = new Map();

// Game state and helper functions
const gameStates = new Map();

function initializeGame(roomId, gameType, initiator) {
    const room = rooms.get(roomId);
    if (!room) return null;

    const players = Array.from(room.users.values()).map(u => u.name);
    const gameState = {
        type: gameType,
        players,
        currentPlayerIndex: 0,
        scores: {},
        data: {}
    };

    switch (gameType) {
        case 'Quick Poll':
            gameState.data = {
                question: null,
                votes: {},
                voted: new Set()
            };
            break;
        
        case 'Word Chain':
            gameState.data = {
                words: [],
                lastLetter: null,
                usedWords: new Set()
            };
            break;
        
        case 'Emoji Story':
            gameState.data = {
                story: [],
                guesses: [],
                currentRound: 1
            };
            break;
        
        case 'Team Trivia':
            gameState.data = {
                currentQuestion: null,
                answers: {},
                score: {}
            };
            break;
    }

    gameStates.set(roomId, gameState);
    return gameState;
}

function getNextPlayer(gameState) {
    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    return gameState.players[gameState.currentPlayerIndex];
}

function updateGameState(roomId, action, data, playerName) {
    const gameState = gameStates.get(roomId);
    if (!gameState) return null;

    switch (gameState.type) {
        case 'Quick Poll':
            if (action === 'submitPoll') {
                gameState.data.question = data.question;
                gameState.data.votes = { yes: 0, no: 0 };
                gameState.data.voted = new Set();
            } else if (action === 'vote' && !gameState.data.voted.has(playerName)) {
                gameState.data.votes[data.vote]++;
                gameState.data.voted.add(playerName);
                
                // End poll if everyone has voted
                if (gameState.data.voted.size === gameState.players.length) {
                    const totalVotes = gameState.data.votes.yes + gameState.data.votes.no;
                    gameState.scores[playerName] = (gameState.scores[playerName] || 0) + 1;
                    return 'end';
                }
            }
            break;

        case 'Word Chain':
            if (action === 'submitWord') {
                const word = data.word.toLowerCase();
                if (!gameState.data.lastLetter || 
                    word.charAt(0) === gameState.data.lastLetter) {
                    if (!gameState.data.usedWords.has(word)) {
                        gameState.data.words.push(word);
                        gameState.data.usedWords.add(word);
                        gameState.data.lastLetter = word.charAt(word.length - 1);
                        gameState.scores[playerName] = (gameState.scores[playerName] || 0) + 1;
                        return 'continue';
                    }
                }
            }
            break;

        case 'Emoji Story':
            if (action === 'addEmoji') {
                gameState.data.story.push(data.emoji);
                gameState.scores[playerName] = (gameState.scores[playerName] || 0) + 1;
                
                // End story after 10 emojis
                if (gameState.data.story.length >= 10) {
                    return 'end';
                }
                return 'continue';
            }
            break;
    }

    return 'continue';
}

// Helper function to get client IP
function getClientIP(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
    }
    return req.socket.remoteAddress;
}

// Cleanup inactive rooms periodically (30 minutes)
setInterval(() => {
  const now = new Date();
  for (const [roomId, room] of rooms.entries()) {
    const inactiveTime = now - room.lastActivity;
    if (inactiveTime > 30 * 60 * 1000 && room.users.size === 0) {
      rooms.delete(roomId);
      console.log(`Removed inactive room: ${roomId}`);
    }
  }
}, 5 * 60 * 1000);

// WebSocket connection handler
wss.on('connection', (ws, req) => {
    const clientIP = getClientIP(req);
    console.log('New connection from:', clientIP);
    
    let userRoom = null;
    let userName = null;

    const sendError = (message) => {
        try {
            ws.send(JSON.stringify({
                type: 'error',
                message
            }));
        } catch (error) {
            console.error('Error sending error message:', error);
        }
    };

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data);

            switch (data.type) {
                case 'join':
                    // Validate input
                    if (!data.roomId?.trim() || !data.name?.trim()) {
                        sendError('Room ID and name are required');
                        return;
                    }

                    if (data.name.length > 50) {
                        sendError('Name is too long (max 50 characters)');
                        return;
                    }

                    userRoom = data.roomId.trim();
                    userName = data.name.trim();
                    
                    // Create room if it doesn't exist
                    if (!rooms.has(userRoom)) {
                        rooms.set(userRoom, {
                            users: new Map(),
                            messages: [],
                            lastActivity: new Date(),
                            ipMap: new Map() // Track IP addresses
                        });
                    }
                    
                    const room = rooms.get(userRoom);
                    room.users.set(ws, { name: userName, ip: clientIP });
                    room.ipMap.set(clientIP, ws);
                    room.lastActivity = new Date();
                    
                    // Send current users to everyone in the room
                    broadcastToRoom(userRoom, {
                        type: 'users',
                        users: Array.from(room.users.values()).map(u => u.name)
                    });

                    // Send message history to new user
                    if (room.messages.length > 0) {
                        // Mark messages that this IP has already reacted to
                        const messagesWithReactionStatus = room.messages.map(msg => ({
                            ...msg,
                            reactions: Object.fromEntries(
                                Object.entries(msg.reactions || {}).map(([reaction, users]) => [
                                    reaction,
                                    Object.fromEntries(
                                        Object.entries(users).map(([name, data]) => [
                                            name,
                                            data.ip === clientIP
                                        ])
                                    )
                                ])
                            )
                        }));

                        ws.send(JSON.stringify({
                            type: 'messages',
                            messages: messagesWithReactionStatus
                        }));
                    }
                    break;

                case 'emoji':
                    if (!userRoom || !rooms.has(userRoom)) {
                        sendError('Not in a room');
                        return;
                    }

                    const emojiRoom = rooms.get(userRoom);
                    const messageData = {
                        type: 'emoji',
                        name: userName,
                        emoji: data.emoji,
                        timestamp: new Date().toLocaleTimeString(),
                        id: Math.random().toString(36).substring(2, 9),
                        reactions: {}
                    };
                    
                    emojiRoom.messages.push(messageData);
                    emojiRoom.lastActivity = new Date();
                    
                    if (emojiRoom.messages.length > 100) {
                        emojiRoom.messages = emojiRoom.messages.slice(-100);
                    }

                    broadcastToRoom(userRoom, messageData);
                    break;

                case 'reaction':
                    if (!userRoom || !rooms.has(userRoom)) {
                        sendError('Not in a room');
                        return;
                    }

                    const reactionRoom = rooms.get(userRoom);
                    const message = reactionRoom.messages.find(m => m.id === data.messageId);
                    
                    if (!message) {
                        sendError('Message not found');
                        return;
                    }

                    // Initialize reactions object if needed
                    if (!message.reactions) {
                        message.reactions = {};
                    }
                    if (!message.reactions[data.reaction]) {
                        message.reactions[data.reaction] = {};
                    }

                    // Check if this IP has already reacted with a different reaction
                    const existingReaction = Object.entries(message.reactions).find(([reaction, users]) =>
                        Object.values(users).some(userData => userData.ip === clientIP)
                    );

                    if (existingReaction) {
                        const [existingReactionType, users] = existingReaction;
                        // Remove the existing reaction
                        const existingUser = Object.entries(users).find(([_, userData]) => userData.ip === clientIP);
                        if (existingUser) {
                            delete message.reactions[existingReactionType][existingUser[0]];
                            // Clean up empty reaction types
                            if (Object.keys(message.reactions[existingReactionType]).length === 0) {
                                delete message.reactions[existingReactionType];
                            }
                            // Broadcast the removal
                            broadcastToRoom(userRoom, {
                                type: 'reaction',
                                messageId: data.messageId,
                                reaction: existingReactionType,
                                name: existingUser[0],
                                status: false
                            });
                        }
                    }

                    // Add the new reaction
                    message.reactions[data.reaction][userName] = {
                        ip: clientIP,
                        timestamp: new Date().toISOString()
                    };

                    reactionRoom.lastActivity = new Date();

                    // Broadcast the new reaction
                    broadcastToRoom(userRoom, {
                        type: 'reaction',
                        messageId: data.messageId,
                        reaction: data.reaction,
                        name: userName,
                        status: true
                    });
                    break;

                case 'startGame':
                    if (!userRoom || !rooms.has(userRoom)) {
                        sendError('Not in a room');
                        return;
                    }

                    const newGameState = initializeGame(userRoom, data.gameType, data.initiator);
                    if (newGameState) {
                        broadcastToRoom(userRoom, {
                            type: 'gameStart',
                            gameType: data.gameType,
                            initialData: newGameState.data,
                            firstPlayer: newGameState.players[0]
                        });
                    }
                    break;

                case 'gameAction':
                    if (!userRoom || !rooms.has(userRoom)) {
                        sendError('Not in a room');
                        return;
                    }

                    const gameState = gameStates.get(userRoom);
                    if (!gameState) {
                        sendError('No active game');
                        return;
                    }

                    const result = updateGameState(userRoom, data.action, data.data, userName);
                    
                    if (result === 'end') {
                        // Game ended
                        broadcastToRoom(userRoom, {
                            type: 'gameEnd',
                            scores: gameState.scores
                        });
                        gameStates.delete(userRoom);
                    } else if (result === 'continue') {
                        // Game continues
                        const nextPlayer = getNextPlayer(gameState);
                        broadcastToRoom(userRoom, {
                            type: 'gameUpdate',
                            gameData: gameState.data,
                            nextPlayer
                        });
                    }
                    break;

                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error processing message:', error);
            sendError('Invalid message format');
        }
    });

    ws.on('close', () => {
        console.log(`User ${userName} (${clientIP}) disconnected from room ${userRoom}`);
        if (userRoom && rooms.has(userRoom)) {
            const room = rooms.get(userRoom);
            room.users.delete(ws);
            room.ipMap.delete(clientIP);
            room.lastActivity = new Date();
            
            if (room.users.size === 0) {
                console.log(`Room ${userRoom} is empty, will be cleaned up if inactive`);
            } else {
                broadcastToRoom(userRoom, {
                    type: 'users',
                    users: Array.from(room.users.values()).map(u => u.name)
                });
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        try {
            ws.close();
        } catch (e) {
            console.error('Error closing connection:', e);
        }
    });
});

// Error handling for WebSocket server
wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});

// Broadcast message to all clients in a room
function broadcastToRoom(roomId, message) {
    if (rooms.has(roomId)) {
        const room = rooms.get(roomId);
        const messageStr = JSON.stringify(message);
        
        room.users.forEach((userData, client) => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(messageStr);
                } catch (error) {
                    console.error('Error broadcasting to client:', error);
                    client.close();
                }
            }
        });
    }
}

// Serve React app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});