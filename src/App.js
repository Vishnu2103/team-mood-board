import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Share2, RefreshCw, Heart, ThumbsUp, Star, Coffee } from 'lucide-react';

const EMOJIS_BY_CATEGORY = {
  'Mood': ["😊", "😃", "🙂", "😐", "😕", "😢", "😡", "🤔", "😴", "🤩", "😎"],
  'Work': ["💪", "🎯", "💡", "🔥", "⭐", "💫", "🚀", "💻", "📚", "✍️", "⚡"],
  'Fun': ["🎮", "🎧", "🎨", "🎭", "🎪", "🎯", "🎲", "🎸", "🎬", "🎪", "🎡"],
  'Food': ["☕", "🍕", "🍔", "🍦", "🍪", "🍫", "🍎", "🥑", "🥤", "🍵", "🍱"],
  'Reactions': ["❤️", "👍", "👏", "🙌", "✨", "🌟", "💯", "🏆", "🎉", "🔥", "💝"]
};

const App = () => {
  // Enhanced state management
  const [userState, setUserState] = useState({
    name: '',
    roomId: new URLSearchParams(window.location.search).get('room') || '',
    isJoined: false,
    selectedCategory: 'Mood'
  });

  const [roomState, setRoomState] = useState({
    messages: [],
    onlineUsers: [],
    reactionCounts: {},
    lastActivity: null
  });

  const [uiState, setUiState] = useState({
    isConnected: false,
    connectionError: '',
    showShareModal: false,
    copiedToClipboard: false,
    showEmojiInfo: null,
    theme: localStorage.getItem('theme') || 'light'
  });

  const wsRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // WebSocket connection setup
  useEffect(() => {
    const connectWebSocket = () => {
      if (reconnectAttempts.current >= maxReconnectAttempts) {
        setUiState(prev => ({ ...prev, connectionError: 'Connection failed. Please refresh the page.' }));
        return;
      }

      try {
        const host = window.location.hostname;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsPort = '3002';
        const wsUrl = `${wsProtocol}//${host}:${wsPort}`;
        
        console.log('Connecting to:', wsUrl);
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          console.log('Connected to server');
          setUiState(prev => ({ ...prev, isConnected: true, connectionError: '' }));
          reconnectAttempts.current = 0;
          
          if (userState.isJoined) {
            ws.send(JSON.stringify({
              type: 'join',
              roomId: userState.roomId,
              name: userState.name
            }));
          }
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          console.log('Received:', data);
          
          switch (data.type) {
            case 'emoji':
              setRoomState(prev => ({
                ...prev,
                messages: [...prev.messages, {
                  ...data,
                  id: Math.random().toString(36).substring(2, 9),
                  reactions: {}
                }],
                lastActivity: new Date()
              }));
              break;
            
            case 'users':
              setRoomState(prev => ({
                ...prev,
                onlineUsers: data.users
              }));
              break;

            case 'messages':
              setRoomState(prev => ({
                ...prev,
                messages: data.messages.map(msg => ({
                  ...msg,
                  reactions: msg.reactions || {}
                })),
                lastActivity: new Date()
              }));
              break;

            case 'reaction':
              setRoomState(prev => {
                const updatedMessages = prev.messages.map(msg => {
                  if (msg.id === data.messageId) {
                    const updatedReactions = {
                      ...msg.reactions,
                      [data.reaction]: {
                        ...msg.reactions?.[data.reaction],
                        [data.name]: data.status // true for add, false for remove
                      }
                    };

                    // Clean up empty reaction objects
                    if (!data.status) {
                      if (Object.keys(updatedReactions[data.reaction]).length === 0) {
                        delete updatedReactions[data.reaction];
                      }
                    }

                    return {
                      ...msg,
                      reactions: updatedReactions
                    };
                  }
                  return msg;
                });

                return {
                  ...prev,
                  messages: updatedMessages
                };
              });
              break;

            default:
              console.log('Unknown message type:', data.type);
          }
        };

        ws.onclose = () => {
          console.log('Disconnected from server');
          setUiState(prev => ({ ...prev, isConnected: false }));
          reconnectAttempts.current += 1;
          setTimeout(connectWebSocket, 3000);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error('Connection error:', error);
        setUiState(prev => ({ ...prev, connectionError: 'Failed to connect to server' }));
      }
    };

    connectWebSocket();
    return () => wsRef.current?.close();
  }, [userState.isJoined, userState.roomId, userState.name]);

  // Handlers
  const handleJoin = useCallback((e) => {
    e.preventDefault();
    if (!userState.name.trim() || !userState.roomId.trim()) {
      setUiState(prev => ({ ...prev, connectionError: 'Please enter both name and room ID' }));
      return;
    }

    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'join',
        roomId: userState.roomId.trim(),
        name: userState.name.trim()
      }));

      // Update URL with room ID
      const url = new URL(window.location.href);
      url.searchParams.set('room', userState.roomId.trim());
      window.history.pushState({}, '', url.toString());

      setUserState(prev => ({ ...prev, isJoined: true }));
    }
  }, [userState.name, userState.roomId]);

  const sendEmoji = useCallback((emoji) => {
    if (!userState.isJoined) {
      setUiState(prev => ({ ...prev, connectionError: 'Please join the room first' }));
      return;
    }
    
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'emoji',
        roomId: userState.roomId,
        emoji,
        name: userState.name
      }));
    }
  }, [userState.isJoined, userState.roomId, userState.name]);

  const handleReaction = useCallback((messageId, reaction) => {
    console.log('Reaction clicked:', messageId, reaction); // Debug log
    if (!userState.isJoined) {
      setUiState(prev => ({ ...prev, connectionError: 'Please join the room first' }));
      return;
    }
    
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'reaction',
        roomId: userState.roomId,
        messageId,
        reaction,
        name: userState.name
      }));
    }
  }, [userState.isJoined, userState.roomId, userState.name]);

  const shareRoom = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', userState.roomId);
    navigator.clipboard.writeText(url.toString())
      .then(() => {
        setUiState(prev => ({ ...prev, copiedToClipboard: true }));
        setTimeout(() => setUiState(prev => ({ ...prev, copiedToClipboard: false })), 2000);
      });
  }, [userState.roomId]);

  const toggleTheme = useCallback(() => {
    setUiState(prev => {
      const newTheme = prev.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      return { ...prev, theme: newTheme };
    });
  }, []);

  // UI Components
  const renderJoinForm = () => (
    <form onSubmit={handleJoin} className="mb-6 space-y-3 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg">
      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-300">Room ID</label>
        <input
          type="text"
          placeholder="Enter room ID"
          value={userState.roomId}
          onChange={(e) => setUserState(prev => ({ ...prev, roomId: e.target.value }))}
          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1 dark:text-gray-300">Your Name</label>
        <input
          type="text"
          placeholder="Enter your name"
          value={userState.name}
          onChange={(e) => setUserState(prev => ({ ...prev, name: e.target.value }))}
          className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          required
          pattern="[A-Za-z0-9\s]+"
          title="Letters, numbers and spaces only"
        />
      </div>
      <button
        type="submit"
        className="w-full bg-blue-500 text-white p-3 rounded-lg hover:bg-blue-600 transition-colors font-medium"
      >
        Join Room
      </button>
    </form>
  );

  const renderRoomHeader = () => (
    <div className="flex items-center justify-between mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2">
          <Users className="w-5 h-5 text-blue-500" />
          <span className="font-medium dark:text-gray-300">{roomState.onlineUsers.length} online</span>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Room: <span className="font-semibold">{userState.roomId}</span>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Name: <span className="font-semibold">{userState.name}</span>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <button
          onClick={shareRoom}
          className="flex items-center space-x-1 px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
        >
          <Share2 className="w-4 h-4" />
          <span>{uiState.copiedToClipboard ? 'Copied!' : 'Share'}</span>
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          {uiState.theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>
    </div>
  );

  const renderEmojiGrid = () => (
    <div className="mb-6 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
      <div className="flex space-x-2 mb-4 overflow-x-auto pb-2">
        {Object.keys(EMOJIS_BY_CATEGORY).map(category => (
          <button
            key={category}
            onClick={() => setUserState(prev => ({ ...prev, selectedCategory: category }))}
            className={`px-4 py-2 rounded-full whitespace-nowrap ${
              userState.selectedCategory === category
                ? 'bg-blue-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {category}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-11 gap-2">
        {EMOJIS_BY_CATEGORY[userState.selectedCategory].map((emoji, index) => (
          <button
            key={index}
            onClick={() => sendEmoji(emoji)}
            onMouseEnter={() => setUiState(prev => ({ ...prev, showEmojiInfo: emoji }))}
            onMouseLeave={() => setUiState(prev => ({ ...prev, showEmojiInfo: null }))}
            className="text-2xl p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all transform hover:scale-110"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );

  const renderMessageFeed = () => (
    <div className="space-y-3 bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md max-h-96 overflow-y-auto">
      {roomState.messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex items-start space-x-3 p-3 rounded-lg ${
            msg.name === userState.name ? 'bg-blue-50 dark:bg-blue-900/30' : 'bg-gray-50 dark:bg-gray-700'
          }`}
        >
          <span className="text-2xl">{msg.emoji}</span>
          <div className="flex-1">
            <div className="flex items-baseline justify-between">
              <span className="font-medium dark:text-gray-300">{msg.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{msg.timestamp}</span>
            </div>
            <div className="flex items-center space-x-2 mt-2">
              {['❤️', '👍', '⭐', '🔥'].map((reaction) => {
                const reactionUsers = msg.reactions?.[reaction] || {};
                const reactionCount = Object.values(reactionUsers).filter(Boolean).length;
                const hasReacted = reactionUsers[userState.name];

                return (
                  <button
                    key={reaction}
                    onClick={() => handleReaction(msg.id, reaction)}
                    className={`text-sm px-2 py-1 rounded transition-all transform hover:scale-105 active:scale-95 ${
                      hasReacted 
                        ? 'bg-blue-100 dark:bg-blue-800 shadow-inner' 
                        : 'hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                    title={
                      reactionCount > 0
                        ? `Reacted by: ${Object.keys(reactionUsers).join(', ')}`
                        : 'Be the first to react!'
                    }
                  >
                    <span className="mr-1">{reaction}</span>
                    {reactionCount > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        hasReacted 
                          ? 'bg-blue-200 dark:bg-blue-700' 
                          : 'bg-gray-200 dark:bg-gray-700'
                      }`}>
                        {reactionCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
      {roomState.messages.length === 0 && userState.isJoined && (
        <div className="text-center text-gray-500 dark:text-gray-400 py-8">
          No responses yet. Be the first to share your mood!
        </div>
      )}
    </div>
  );

  return (
    <div className={uiState.theme}>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 py-8">
        <div className="max-w-4xl mx-auto px-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-center text-gray-800 dark:text-white mb-2">
              Team Mood Board
            </h1>
            <p className="text-center text-gray-600 dark:text-gray-400">
              Share your mood with your team in real-time
            </p>
          </div>
          
          {/* Connection Status */}
          <div className={`text-center mb-6 ${
            uiState.isConnected ? 'text-green-500' : 'text-red-500'
          }`}>
            {uiState.isConnected ? 'Connected' : 'Connecting...'}
            {uiState.connectionError && (
              <div className="text-red-500 text-sm mt-1">{uiState.connectionError}</div>
            )}
          </div>

          {/* Main Content */}
          {!userState.isJoined ? renderJoinForm() : (
            <>
              {renderRoomHeader()}
              {renderEmojiGrid()}
              {renderMessageFeed()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;