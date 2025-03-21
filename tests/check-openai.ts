import OpenAI from "openai";

// OpenAI key from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function checkOpenAI() {
  try {
    // Validate environment variable
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    
    console.log("Testing OpenAI API key validity...");
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    
    // Try a simple completion request
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say hello" }],
      max_tokens: 5
    });
    
    console.log("OpenAI API key is valid!");
    console.log("Response:", response.choices[0]?.message?.content);
    return true;
  } catch (error) {
    console.log("Error testing OpenAI API key:", error);
    return false;
  }
}

checkOpenAI();
