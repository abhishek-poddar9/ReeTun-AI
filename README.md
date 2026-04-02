# ReeTunAI

ReeTunAI is a scalable AI-powered web platform that enables users to generate content, process images, and analyze resumes through a secure and modular full-stack architecture.

## Features

- AI-based article generation
- Blog title generation
- AI image generation
- Image background removal
- Object removal from images
- Resume review and analysis
- PDF text extraction
- User-specific creation history
- Public/published creations feed
- Like and engagement system
- Free vs premium plan handling
- Secure authentication and route protection

## Tech Stack

### Frontend
- React.js
- JavaScript
- HTML5
- CSS3
- Tailwind CSS
- Axios


### Backend
- Node.js
- Express.js
- PostgreSQL (Database)
- Neon Serverless (Cloud Database Hosting)
- Clerk (Authentication & User Management)
- Cloudinary (Media Storage & Processing)
- Multer (File Upload Handling)
- Google Gemini API (AI Processing)
- OpenAI SDK (Gemini-Compatible Integration)
- PDF-Parse (PDF Text Extraction)
- Axios (HTTP Requests)
- CORS (Cross-Origin Handling)
- Dotenv (Environment Configuration)

## Architecture Overview

### Frontend
The frontend is responsible for rendering the user interface, handling user interactions, sending requests to backend APIs, and displaying generated AI content and image processing results.

### Backend
The backend manages API routes, user authentication, AI service integration, media uploads, database operations, PDF parsing, and usage control for free and premium users.

### Database
PostgreSQL is used for storing user-related data, creation history, likes, and published content. Neon Serverless is used as the cloud-hosted database provider.

