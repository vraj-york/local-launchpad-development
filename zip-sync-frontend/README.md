# Zip Sync Frontend

A modern, responsive dashboard for managing projects, uploading builds, and viewing live applications.

## Features

- **Modern Dashboard**: Clean, intuitive interface with sidebar navigation
- **Role-based Access**: Different permissions for Admin, Manager, and Client roles
- **Project Management**: Create, view, and manage projects
- **Build Upload**: Upload ZIP files and automatically build projects
- **Live Viewing**: Access live URLs for deployed projects
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Real-time Updates**: Live status updates and progress tracking

## Tech Stack

- **React 18** - Modern React with hooks
- **React Router 6** - Client-side routing
- **Axios** - HTTP client with interceptors
- **Vite** - Fast build tool and dev server
- **CSS3** - Modern styling with flexbox and grid

## Getting Started

### Prerequisites

- Node.js 16+ 
- npm or yarn
- Backend server running on port 5000

### Installation

1. Navigate to the frontend directory:
```bash
cd zip-sync-frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Dashboard.jsx    # Main dashboard layout
│   ├── Sidebar.jsx      # Navigation sidebar
│   ├── DashboardHome.jsx # Dashboard overview
│   ├── ProjectManagement.jsx # Project CRUD operations
│   ├── ProjectUpload.jsx # File upload component
│   └── ProjectView.jsx  # Project viewing and filtering
├── context/             # React context providers
│   └── AuthContext.jsx  # Authentication state management
├── pages/               # Page components
│   └── LoginPage.jsx    # Login/authentication page
├── api/                 # API integration
│   └── index.js         # API functions and axios config
├── styles/              # Global styles
│   └── main.css         # Main stylesheet
└── utils/               # Utility functions
    └── auth.js          # Authentication helpers
```

## User Roles

### Admin
- Full access to all projects
- Can create, edit, and delete projects
- Can upload builds for any project
- Can assign managers to projects

### Manager
- Can manage assigned projects
- Can upload builds for assigned projects
- Can view project details and live URLs

### Client
- Can view projects they have access to
- Can access live URLs for accessible projects
- Limited to viewing only

## API Integration

The frontend integrates with the backend API endpoints:

- `POST /api/auth/login` - User authentication
- `GET /api/projects` - Fetch user's projects
- `POST /api/projects` - Create new project
- `POST /api/projects/:id/upload` - Upload project build
- `GET /api/projects/:id/live-url` - Get project live URL

## Responsive Design

The dashboard is fully responsive with:

- **Desktop**: Full sidebar navigation with main content area
- **Tablet**: Collapsible sidebar with touch-friendly interface
- **Mobile**: Hamburger menu with overlay sidebar

## Demo Credentials

For testing purposes, use these demo accounts:

- **Admin**: admin@example.com / admin123
- **Manager**: manager@example.com / manager123  
- **Client**: client@example.com / client123

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run serve` - Preview production build

### Code Style

The project follows modern React patterns:

- Functional components with hooks
- Context API for state management
- Custom hooks for reusable logic
- CSS modules for component styling

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC License