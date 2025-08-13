# PIN'oy (Backend)

This repository contains the backend API for the PIN'oy application. It is a Node.js server written in TypeScript using the Express framework. It provides all the necessary endpoints for the frontend to function, handles user authentication, content moderation, and database interactions.

## Key Features

-   **RESTful API:** Built with Express.js to manage users, posts, comments, likes, views, and reports.
-   **Database & Auth:** Utilizes Supabase for its PostgreSQL database, JWT-based authentication, and file storage.
-   **Advanced Content Moderation:** A multi-layered system to validate user-generated content:
    -   **Text Analysis:** Blocks a wide range of profanity and suspicious URL patterns.
    -   **Image Analysis:** Combines skin-tone detection (`sharp`) and text recognition/OCR (`Tesseract.js`) to flag potentially explicit images.
-   **User Management:** Handles user registration, login, and profile updates, with automatic profile creation in the public schema via a database trigger.
-   **File Uploads:** Manages image uploads with `multer` and stores them in Supabase Storage.
-   **Performance:** Implements a `node-cache` layer to cache frequently accessed data and reduce database load.
-   **Serverless Deployment:** Configured for easy deployment on Vercel.

## Tech Stack

-   **Core**: Node.js, Express, TypeScript
-   **Database/Auth**: Supabase, PostgreSQL
-   **Image & Text Analysis**: Sharp, Tesseract.js, leo-profanity, validator
-   **Development**: `ts-node-dev` for live reloading

## API Endpoints

The API routes are defined under `src/routes` and prefixed with `/api/v1`.

-   `/api/v1/users`: User registration, login, and profile management.
-   `/api/v1/posts`: Creating, reading, updating, and deleting posts.
-   `/api/v1/posts/:id/comments`: Managing comments for a post.
-   `/api/v1/posts/:id/likes`: Liking and unliking posts.
-   `/api/v1/posts/reports`: Reporting posts.

## Prerequisites

-   Node.js (v18 or higher)
-   npm (v8 or higher)
-   A Supabase project.

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <your-repo-url>/backend-pinom.git
cd backend-pinom
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file in the root directory and add the following variables:

```
# Supabase credentials
SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Server port
PORT=3000
```

### 4. Set Up Supabase Database

To set up the required database schema and policies, execute the SQL scripts in your Supabase project's SQL Editor in the following order:

1.  `SQL.sql` - Creates the main tables (`users`, `posts`, `comments`, etc.).
2.  `CommePolicy.sql` - Applies Row Level Security (RLS) policies to the `comments` table.
3.  `Report.sql` - Creates the `reports` table and its associated policies.
4.  `SYNC-users-auth.sql` - Creates the trigger to sync new users from `auth.users` to `public.users`.

### 5. Run Locally

This command starts the server with `ts-node-dev`, which will automatically restart on file changes.

```bash
npm run dev
```

The API will be running at `http://localhost:3000`.
