import * as needle from "cactus-needle";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Complete standalone runtime file for Cactus Needle 3:
 * - Pure inference & tool dispatch
 * - Structured data extraction
 * - Text embedding generation & cosine similarity
 * - In-memory vector memory store
 */

// 1. Tool-Calling Inference Setup
const weatherTool = {
  name: "get_weather",
  description: "Get the current weather for a city",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string" },
    },
    required: ["city"],
  },
};

export class MemoryStore {
  private memories: Array<{ id: string; text: string; vector: Float32Array }> = [];

  constructor(private needleInstance: needle.Needle) {}

  public async save(text: string): Promise<void> {
    const embedding = await this.needleInstance.embed(text);
    this.memories.push({
      id: crypto.randomUUID(),
      text,
      vector: new Float32Array(embedding),
    });
  }

  public async recall(query: string, topK = 3): Promise<Array<{ text: string; score: number }>> {
    const queryEmbedding = await this.needleInstance.embed(query);
    const queryVec = new Float32Array(queryEmbedding);

    return this.memories
      .map((item) => {
        if (item.vector.length !== queryVec.length || queryVec.length === 0) {
          return { text: item.text, score: 0 };
        }
        let dot = 0;
        let queryMagnitude = 0;
        let itemMagnitude = 0;
        for (let i = 0; i < queryVec.length; i++) {
          const queryValue = queryVec[i] ?? 0;
          const itemValue = item.vector[i] ?? 0;
          dot += queryValue * itemValue;
          queryMagnitude += queryValue * queryValue;
          itemMagnitude += itemValue * itemValue;
        }
        const denominator = Math.sqrt(queryMagnitude * itemMagnitude);
        return { text: item.text, score: denominator === 0 ? 0 : dot / denominator };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

async function main() {
  // Initialize instance with your tools
  const instance = new needle.Needle({
    tools: [weatherTool],
  });

  try {
    console.log("--- 1. Pure Inference & Tool Calling ---");
    const callResult = await instance.complete("What is the weather in Kochi?");
    console.log("Predicted calls:", JSON.stringify(callResult.function_calls, null, 2));

    console.log("\n--- 2. Structured Extraction ---");
    const extractSchema = {
      type: "object",
      properties: {
        task: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["task", "priority"],
    };

    const extracted = await instance.extract(
      "Need to deploy the updated backend service urgently by 4 PM",
      extractSchema,
    );
    console.log("Extracted:", extracted);

    console.log("\n--- 3. Native Embeddings ---");
    const embedResult = await instance.embed("Deploying container updates to edge nodes");
    const vector = new Float32Array(embedResult);
    console.log(`Vector generated (dimensions: ${vector.length})`);
    console.log("Sample values:", vector.slice(0, 5));

    console.log("\n--- 4. Memory Store in Action ---");
    const memory = new MemoryStore(instance);

    await memory.save("User prefers dark mode UI themes");
    await memory.save("User is testing lightweight Edge AI agent architectures");
    await memory.save("User likes spicy Indian food");

    const matches = await memory.recall("Any settings or interface preferences?");
    console.log("Recalled Memories:");
    for (const match of matches) {
      console.log(`- [Score: ${match.score.toFixed(3)}] ${match.text}`);
    }
  } finally {
    // Release native resources / WASM runtime
    await instance.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(console.error);
}
