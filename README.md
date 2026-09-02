# MemoryBook
## Judge Quick Start

Live app: https://memorybook-app.onrender.com

MemoryBook has been tested end-to-end with WebMCP in the ChatGPT in-app browser.

Suggested WebMCP test prompts:

- "What WebMCP tools does this MemoryBook expose?"
- "List the contributions in this MemoryBook."
- "Analyze which important school-year events are missing from the contributions."
- "Show me the current book context."
- "Propose a thematic MemoryBook spread using the submitted memories."

For a write test, ask the agent to build the proposed thematic spread. MemoryBook requires explicit human approval before the WebMCP write operation executes.

After approval, refresh the normal MemoryBook editor to see the saved result. The generated page remains fully editable by the human.
MemoryBook is a collaborative digital memory book where people contribute memories and photos, while AI can understand the book, analyze what is missing, organize contributions, and help build the final book through WebMCP.

The project demonstrates a human-controlled workflow in which an AI agent works with a real web application through semantic WebMCP tools instead of manipulating raw UI state.

## Live Demo

https://memorybook-app.onrender.com

Demo book: **12.B – Our Last Year**

## Why WebMCP?

A memory book contains more than pages and text boxes. It contains people, memories, events, photos, themes, and an evolving book structure.

MemoryBook exposes these concepts directly to AI agents through WebMCP.

The agent does not need access to raw Fabric.js canvas JSON. Instead, it receives semantic tools for understanding and modifying the book.

This enables an AI agent to inspect contributions, understand the state of the book, identify missing events, propose layouts, build approved pages, and reorganize the book.

The result remains editable by the human in the normal MemoryBook editor.

## WebMCP Tools

MemoryBook exposes six WebMCP tools.

### get_memorybook_status
Returns a simple read-only status of the currently open MemoryBook demo.

### get_book_context
Returns semantic context about the MemoryBook book, its pages, and contributed memories without exposing raw Fabric canvas JSON.

### list_contributions
Returns submitted MemoryBook contributions in semantic form, including contributor names, memory text, and available photos.

### get_event_coverage
Analyzes submitted contributions against important school-year events and reports which events are covered and which are still missing.

### build_thematic_spread
Builds a deterministic MemoryBook page from approved submitted memories.

This is a write operation and requires explicit human approval before the page is created and saved.

### reorder_pages
Changes the order of all MemoryBook pages.

This is also a write operation and requires explicit human approval before execution.

## Human-in-the-Loop Design

MemoryBook deliberately separates AI planning from persistent write operations.

Read-only tools can inspect the book directly. Write tools such as build_thematic_spread and reorder_pages require explicit human approval.

The AI can therefore propose useful changes while the user retains control over what is actually written into the book.

## Example WebMCP Workflow

A contributor submits a memory and optionally a photo through the public invitation page.

An AI agent can then:

1. inspect the contributions with list_contributions;
2. understand the whole book with get_book_context;
3. identify missing events with get_event_coverage;
4. propose a thematic layout;
5. request human approval;
6. create the approved page with build_thematic_spread;
7. reorganize the book with reorder_pages when requested.

The saved result immediately becomes part of the normal editable MemoryBook.

## Current Demo

The public demo contains the book:

**12.B – Our Last Year**

The deployed application includes:

- visual page editing
- text and image content
- drawing and erasing
- undo and redo
- autosave and manual save
- versioned page persistence
- page previews
- invitation-based memory submission
- photo contributions
- organizer contribution view
- read-only book view
- page ordering
- WebMCP integration

## Architecture

Frontend:
- React
- TypeScript
- Vite
- Fabric.js

Backend:
- Node.js
- Express
- PostgreSQL

Image storage:
- Cloudinary

Deployment:
- Render

AI/browser integration:
- WebMCP

## Local Development

Requirements:
- Node.js
- PostgreSQL
- Cloudinary account

Install dependencies:

    npm install

Create a local .env file with:

    DATABASE_URL=your_postgresql_connection_string
    CLOUDINARY_CLOUD_NAME=your_cloud_name
    CLOUDINARY_API_KEY=your_api_key
    CLOUDINARY_API_SECRET=your_api_secret

Never commit the .env file or real credentials.

Start the backend:

    npx tsx server/index.ts

In another terminal, start the Vite frontend:

    npm run dev

Create a production build:

    npm run build

## Production

The production deployment builds with:

    npm install && npm run build

and starts the server with:

    npx tsx server/index.ts

The Express server serves the built Vite frontend and the MemoryBook API from the same deployment.

## Data and Persistence

Book and page data are stored in PostgreSQL.

Page previews and contribution photos are stored in Cloudinary so uploaded images survive application restarts and ephemeral deployment filesystems.

Page saves are versioned to protect against stale writes.

## WebMCP Challenge Demo Flow

Contribution -> AI reads MemoryBook -> AI analyzes context -> AI proposes a page -> human approves -> WebMCP builds and saves the page -> result appears in the editable MemoryBook.

This demonstrates WebMCP as an application-level interface between an AI agent and a real collaborative creative product.

## Repository

This repository contains the MemoryBook competition prototype and its WebMCP implementation.

## Challenge Development Scope

MemoryBook existed before the WebMCP Challenge as a working collaborative memory-book prototype. The pre-existing application already included the visual editor, page persistence, contribution submission, organizer view, and read-only book view.

During the WebMCP Challenge, the project was meaningfully extended with the WebMCP integration and agent-facing semantic workflow.

Challenge-period work includes:

- six semantic WebMCP tools
- AI-readable book and contribution context
- semantic event-coverage analysis
- human-in-the-loop thematic spread creation
- WebMCP page reordering
- explicit approval before persistent AI write operations
- production WebMCP integration with the deployed MemoryBook application

The challenge extension turns MemoryBook from a web application operated only through its UI into an application that AI agents can understand and safely collaborate with through semantic WebMCP tools.