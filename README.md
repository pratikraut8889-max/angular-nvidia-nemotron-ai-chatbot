
MyApp
This project features a full-stack architecture generated using Angular CLI version 21.2.24 with Angular 21 SSR and an embedded Express.js + MongoDB API backend running via a unified server setup.
Project Architecture
This application operates as a unified monolith:
    • Frontend: Angular 21 with server-side rendering (SSR).
    • Backend: ExpressJS API engine mounted under the /api prefix path via server.ts.
    • Database Async Boot: The Node process awaits a successful MongoDB connection before opening up standard traffic ports.
Local Development Server
1. Configure Environment Variables
Create a .env file in your root folder:
env
MONGODB_URI=your_local_or_atlas_mongodb_connection_string
JWT_SECRET=your_jwt_signing_secret_key
PORT=4000
Use code with caution.
2. Start the App
To start the standard local development server for the frontend layout, run:
bash
ng serve
Use code with caution.
Once running, navigate to http://localhost:4200/.
Note: For the full SSR + custom backend experience locally, build the project and execute the compiled bundle using the SSR production script described below.
Code Scaffolding
Angular CLI includes powerful code scaffolding tools. To generate a new component, run:
bash
ng generate component component-name
Use code with caution.
For a complete list of available schematics (such as components, directives, or pipes), run:
bash
ng generate --help
Use code with caution.
Building
To compile both the Angular SSR engine and your integrated Express API routes, run:
bash
npm run build
Use code with caution.
This command compiles your application bundles into the dist/ directory, outputting a static browser/ directory and a unified executable node application folder (server/).
Running the Production Build Locally
To test the compiled SSR server combined with the Express backend on your local device, execute:
bash
npm run serve:ssr
Use code with caution.
The node server will open up on http://localhost:4000/. Your Angular UI is served dynamically, and backend routes live natively at http://localhost:4000/api.
Deployment to Render
To host this project live as a single scalable instance, deploy it as a Render Web Service using the steps below:
1. Render Dashboard Setup
• Runtime: Node
• Build Command: npm install && npm run build
• Start Command: npm run serve:ssr
2. Required Environment Variables
Add these inside Render's Advanced Settings workspace:
• MONGODB_URI : (Your production MongoDB Atlas connection string)
• JWT_SECRET : (Your secure JWT token passphrase)
• NODE_VERSION : 20 or 22 (Ensures a modern Node environment matching Angular 21 parameters)
Running Unit Tests
To execute unit tests with the Vitest test runner, use the following command:
bash
ng test
Use code with caution.
Running End-to-End Tests
For end-to-end (e2e) testing, run:
bash
ng e2e
Use code with caution.
Additional Resources
For more information on using the Angular CLI, including detailed command references, visit the Angular CLI Overview and Command Reference page.
