#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import instructions from '../../../docs/agents/animation-principles.md';
import { createServer } from './server.js';

const server = createServer({ instructions });
await server.connect(new StdioServerTransport());
