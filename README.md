# Team Mood Board

A real-time collaborative mood board for remote teams. Team members can share their moods using emojis and participate in discussions.

## Features

- Real-time emoji sharing
- Room-based collaboration
- Online user tracking
- Discussion points for team leads
- Shareable room links
- Automatic reconnection
- Mobile-responsive design

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

This will start both the frontend and backend servers.

- Frontend: http://localhost:3000
- Backend WebSocket: ws://localhost:3000

## Production Build

1. Build the React app:
```bash
npm run build
```

2. Start the production server:
```bash
npm run server
```

The server will serve the built React app and handle WebSocket connections.

## Environment Variables

- `PORT`: Server port (default: 3000)

## Technologies Used

- React
- WebSocket
- Express
- Tailwind CSS
- Lucide Icons