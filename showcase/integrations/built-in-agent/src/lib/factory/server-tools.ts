import { z } from "zod";
import { toolDefinition } from "@tanstack/ai";

export const weatherTool = toolDefinition({
  name: "weather",
  description: "Get current weather for a city",
  inputSchema: z.object({
    city: z.string(),
  }),
}).server(async ({ city }) => ({
  city,
  tempF: 72,
  condition: "Partly cloudy",
  humidity: 0.45,
}));

export const haikuTool = toolDefinition({
  name: "haiku",
  description: "Generate a haiku about a topic",
  inputSchema: z.object({
    topic: z.string(),
  }),
}).server(async ({ topic }) => ({
  topic,
  lines: [
    "Lines on a topic",
    `Eight syllables, on ${topic}`,
    "Then five at the close",
  ],
}));

export const baseServerTools = [weatherTool, haikuTool] as const;
