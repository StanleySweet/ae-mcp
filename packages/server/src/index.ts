#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import guide from '../../../docs/agents/animation-principles.md';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { createServer } from './server.js';

const server = createServer({ instructions: SERVER_INSTRUCTIONS, guide });
await server.connect(new StdioServerTransport());
