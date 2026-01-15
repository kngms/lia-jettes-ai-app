import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GoogleGenAI } from "@google/genai";
import * as cors from "cors";

// Initialize Firebase Admin
admin.initializeApp();

// Configure CORS to allow requests from your app
const corsHandler = cors({ origin: true });

/**
 * Cloud Function to proxy Gemini API calls securely.
 * This keeps the API key on the server and never exposes it to the client.
 * 
 * The function accepts the same parameters that would be sent to the Gemini API
 * and forwards them, returning the response back to the client.
 */
export const callGemini = functions.https.onRequest((request, response) => {
  corsHandler(request, response, async () => {
    // Only allow POST requests
    if (request.method !== "POST") {
      response.status(405).send({ error: "Method Not Allowed" });
      return;
    }

    try {
      // Verify the user is authenticated (required for security)
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        response.status(401).send({ error: "Unauthorized - No token provided" });
        return;
      }

      const idToken = authHeader.split("Bearer ")[1];
      
      try {
        // Verify Firebase ID token
        await admin.auth().verifyIdToken(idToken);
      } catch (error) {
        console.error("Token verification failed:", error);
        response.status(401).send({ error: "Unauthorized - Invalid token" });
        return;
      }

      // Get the Gemini API key from environment variables
      const apiKey = functions.config().gemini?.apikey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        console.error("GEMINI_API_KEY not configured");
        response.status(500).send({ error: "API key not configured" });
        return;
      }

      // Initialize Gemini AI
      const ai = new GoogleGenAI({ apiKey });

      // Extract parameters from request body
      const { model, contents, config } = request.body;

      if (!model || !contents) {
        response.status(400).send({ error: "Missing required parameters: model and contents" });
        return;
      }

      // Call Gemini API
      const result = await ai.models.generateContent({
        model,
        contents,
        config: config || {},
      });

      // Return the response
      response.status(200).json({
        text: result.text,
        candidates: result.candidates,
        usageMetadata: result.usageMetadata,
      });

    } catch (error: any) {
      console.error("Error calling Gemini API:", error);
      response.status(500).send({ 
        error: "Failed to process request",
        message: error.message 
      });
    }
  });
});
