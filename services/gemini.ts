
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Tone, Length, MemoryItem, AppSettings, Persona, KnowledgeSource, KnowledgeMetadata } from "../types";
import { secureGenerateContent } from "./secureApi";

// Feature flag to switch between direct API and Cloud Function
// Set to true to use Firebase Cloud Function (secure), false for local dev with API key
const USE_CLOUD_FUNCTION = import.meta.env.VITE_USE_CLOUD_FUNCTION === 'true';
const API_KEY = USE_CLOUD_FUNCTION ? undefined : import.meta.env.VITE_GEMINI_API_KEY;

// Usage Tracking for Billing Transparency
const trackUsage = (model: string, usage: any) => {
  if (!usage) return;
  const today = new Date().toISOString().split('T')[0];
  const history = JSON.parse(localStorage.getItem('usageHistory') || '{}');
  
  if (!history[today]) {
    history[today] = { inputTokens: 0, outputTokens: 0, calls: 0, cost: 0 };
  }
  
  history[today].inputTokens += (usage.promptTokenCount || 0);
  history[today].outputTokens += (usage.candidatesTokenCount || 0);
  history[today].calls += 1;
  
  let cost = 0;
  const input = (usage.promptTokenCount || 0);
  const output = (usage.candidatesTokenCount || 0);
  
  if (model.includes('pro')) {
    cost = (input / 1000000) * 1.25 + (output / 1000000) * 5.00;
  } else if (model.includes('flash')) {
    cost = (input / 1000000) * 0.075 + (output / 1000000) * 0.30;
  }
  
  history[today].cost += cost;
  localStorage.setItem('usageHistory', JSON.stringify(history));
};

// Helper to call Gemini API either directly or through Cloud Function
const callGeminiAPI = async (params: { model: string; contents: any; config?: any }) => {
  if (USE_CLOUD_FUNCTION) {
    // Use secure Cloud Function
    return await secureGenerateContent(params);
  } else {
    // Use direct API for local development
    if (!API_KEY) {
      throw new Error('VITE_GEMINI_API_KEY environment variable not configured. Please set it in your .env file.');
    }
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    return await ai.models.generateContent(params);
  }
};

// Audio Decoding Helpers
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Helper to convert AudioBuffer to WAV for download
export function bufferToWav(abuffer: AudioBuffer, len: number) {
  let numOfChan = abuffer.numberOfChannels,
      length = len * numOfChan * 2 + 44,
      buffer = new ArrayBuffer(length),
      view = new DataView(buffer),
      channels = [], i, sample,
      offset = 0,
      pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded in this example)

  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for(i = 0; i < abuffer.numberOfChannels; i++)
    channels.push(abuffer.getChannelData(i));

  while(pos < len) {
    for(i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true);          // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([buffer], {type: "audio/wav"});

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}

export const textToSpeech = async (text: string, voiceName: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr' = 'Kore') => {
  // TTS requires direct API access with specific features not available in cloud function
  if (USE_CLOUD_FUNCTION) {
    throw new Error('Text-to-Speech requires direct API access. Please configure VITE_USE_CLOUD_FUNCTION=false for TTS features.');
  }
  if (!API_KEY) {
    throw new Error('VITE_GEMINI_API_KEY environment variable not configured. Please set it in your .env file.');
  }
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Lies das bitte klar und deutlich vor: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  trackUsage("gemini-2.5-flash-preview-tts", response.usageMetadata);

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) return null;

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const audioBuffer = await decodeAudioData(
    decode(base64Audio),
    audioContext,
    24000,
    1,
  );

  return { audioBuffer, audioContext };
};

export const extractTextFromSources = async (
  files: { data: string; mimeType: string; name?: string }[],
  links: string[]
) => {
  const contentParts: any[] = [];
  
  // Add Files
  files.forEach(f => {
    // If it's a text-based file (including our extracted DOCX content), decode it and send as text
    if (f.mimeType.startsWith('text/') || f.mimeType === 'application/json') {
       try {
           const text = decodeURIComponent(escape(atob(f.data)));
           contentParts.push({ text: `\n--- START OF FILE: ${f.name || 'Text File'} ---\n${text}\n--- END OF FILE ---\n` });
       } catch (e) {
           console.error("Failed to decode text file", e);
           // Fallback to inlineData if decoding fails, though it might not work well for text types
           contentParts.push({
             inlineData: {
               mimeType: f.mimeType,
               data: f.data
             }
           });
       }
    } else {
       // For PDF and Images, use inlineData
       contentParts.push({
         inlineData: {
           mimeType: f.mimeType,
           data: f.data
         }
       });
    }
  });

  // Add Links
  if (links.length > 0) {
    contentParts.push({
      text: `Please also consider content from these URLs: ${links.join(', ')}`
    });
  }

  contentParts.push({
    text: `
      Aufgabe: Extrahiere und kombiniere den gesamten Text aus den angehängten Dokumenten und Bildern.
      1. Ignoriere Kopf- und Fußzeilen, Seitenzahlen oder irrelevante Metadaten.
      2. Formatier den Text sauber, damit er sich gut vorlesen lässt.
      3. Wenn es mehrere Dokumente sind, trenne sie logisch mit einer Überschrift.
      4. Gib NUR den bereinigten Text zurück, keine Erklärungen.
    `
  });

  const response = await callGeminiAPI({
    model: 'gemini-3-flash-preview',
    contents: { parts: contentParts },
    config: {
      tools: links.length > 0 ? [{ googleSearch: {} }] : undefined
    }
  });

  trackUsage('gemini-3-flash-preview', response.usageMetadata);
  return response.text;
};

// --- Knowledge Processing (Backend Simulation) ---

export const processKnowledgeSource = async (
  name: string,
  content: string, // URL or Base64
  mimeType: string,
  customTags: string[] = []
): Promise<KnowledgeSource> => {
  const isUrl = mimeType === 'link' || mimeType.includes('youtube');
  const defaultTags = ["Work", "Personal", "Research", "Media", "Finance"];
  
  const processingPrompt = `
    You are a backend document processor. Analyze this content to create a metadata JSON.
    
    Content Name: ${name}
    Type: ${mimeType}
    ${isUrl ? `URL: ${content}` : 'Content is attached as file.'}
    
    Tasks:
    1. Summarize the content in 2-3 sentences.
    2. Assign 2-3 tags from this list: ${defaultTags.join(', ')}. If none fit, create a new relevant tag.
    3. Extract 3-5 key entities (names, topics, companies).
    4. If it's a YouTube Playlist link, identify that it is a collection.
    
    Output strictly in JSON format matching this schema:
    {
      "title": "Clean Title",
      "summary": "Summary text",
      "type": "document" | "video" | "audio" | "webpage",
      "tags": ["tag1", "tag2"],
      "key_entities": ["entity1", "entity2"]
    }
  `;

  const inputParts: any[] = [{ text: processingPrompt }];
  
  if (isUrl) {
    // For URLs we rely on Google Search grounding to fetch info
  } else {
    // For files, attach inline
    inputParts.push({
      inlineData: {
        data: content,
        mimeType: mimeType
      }
    });
  }

  const response = await callGeminiAPI({
    model: 'gemini-3-flash-preview',
    contents: { parts: inputParts },
    config: {
      responseMimeType: "application/json",
      tools: isUrl ? [{ googleSearch: {} }] : undefined,
    }
  });
  
  trackUsage('gemini-3-flash-preview', response.usageMetadata);

  let metadata: KnowledgeMetadata = {
    title: name,
    summary: "Could not process",
    type: 'document',
    tags: [],
    key_entities: [],
    created_at: new Date().toISOString(),
    chunk_count: 0,
    original_source: isUrl ? content : undefined
  };

  let chunks: string[] = [];

  try {
    const json = JSON.parse(response.text || "{}");
    metadata = {
      ...metadata,
      ...json,
      created_at: new Date().toISOString()
    };
    
    // Add user provided custom tags if any
    metadata.tags = [...new Set([...metadata.tags, ...customTags])];

    // Simulate Chunking (Backend process)
    if (!isUrl) {
        chunks = [metadata.summary]; 
    }

  } catch (e) {
    console.error("Metadata parsing failed", e);
  }

  return {
    id: Date.now().toString(),
    name,
    content,
    mimeType,
    metadata,
    chunks,
    status: 'ready'
  };
};

export const generatePodcastScript = async (
  topic: string, 
  personas: Persona[], 
  format: string = 'Discussion',
  sources: string[] = [],
  duration: '5' | '15' | '30' = '5'
) => {
  const speakers = personas.map(p => `${p.name} (Role: ${p.socialStatus}, Charakter: ${p.personalityTraits})`).join(', ');
  
  // Calculate target word count (approx 150 words per minute)
  // We double it because models often under-generate
  const wordCount = parseInt(duration) * 160;

  const sourcesText = sources.length > 0 
    ? `\nBASIS-MATERIAL / QUELLEN (Analysiere diese Inhalte):\n${sources.join('\n')}` 
    : '';

  const prompt = `Erstelle ein professionelles Podcast-Skript auf DEUTSCH.
  
  Thema: "${topic}"
  Format: ${format} (z.B. Diskussion, Pro/Kontra, Erfahrungsbericht).
  Die Sprecher sind: ${speakers}.
  
  ${sourcesText}
  
  WICHTIG: Nutze die Google Suche oder das bereitgestellte Material, um die Inhalte der Links zu verstehen, falls Links vorhanden sind.
  
  Kontext: Zielgruppe sind Jette (Soziologie Master, Arbeiterkind) und Chris.
  Stil: "NotebookLM"-artig – eine tiefe Analyse, aber unterhaltsam.
  
  CRITICAL AUDIO INSTRUCTIONS:
  - This script is for a Text-To-Speech engine.
  - DO NOT include "[Sound Effect]", "[Music]", "[Intro]", "[Applause]", or "[Jingle]".
  - DO NOT describe sounds. ONLY write the spoken text.
  - The TTS engine cannot make music.
  - Make the conversation purely dialogue.
  
  Anweisungen:
  - Wenn Quellen (Links/PDF-Namen) angegeben sind, bezieh dich darauf ("Laut dem Artikel...").
  - Halte es authentisch (kurze Unterbrechungen, "Ähm", Lachen - schreibe [lacht] nur wenn es gesprochen werden soll).
  - Ziel-Länge: Versuche ca. ${wordCount} Wörter zu erreichen (für ${duration} Minuten Audio). Erzeuge so viel tiefgehenden Inhalt wie möglich.
  
  Format Output:
  [Sprecher Name]: [Text]
  `;

  const response = await callGeminiAPI({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      tools: sources.some(s => s.includes('http')) ? [{ googleSearch: {} }] : undefined,
      thinkingConfig: { thinkingBudget: 16000 } // Boost thinking for longer content
    }
  });
  
  trackUsage('gemini-3-pro-preview', response.usageMetadata);
  return response.text;
};

export const synthesizeMultiSpeakerAudio = async (script: string, personas: Persona[]) => {
  // TTS requires direct API access with specific features not available in cloud function
  if (USE_CLOUD_FUNCTION) {
    throw new Error('Multi-Speaker Audio requires direct API access. Please configure VITE_USE_CLOUD_FUNCTION=false for TTS features.');
  }
  if (!API_KEY) {
    throw new Error('VITE_GEMINI_API_KEY environment variable not configured. Please set it in your .env file.');
  }
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const speakerVoiceConfigs = personas.map(p => ({
    speaker: p.name,
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: p.voice }
    }
  }));

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `TTS the following conversation:\n${script}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: speakerVoiceConfigs
        }
      },
    },
  });

  trackUsage("gemini-2.5-flash-preview-tts", response.usageMetadata);

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) return null;

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  const audioBuffer = await decodeAudioData(
    decode(base64Audio),
    audioContext,
    24000,
    1,
  );

  return { audioBuffer, audioContext };
};

const getUserMemory = (): string => {
  try {
    const memory = localStorage.getItem('userMemory');
    if (!memory) return "";
    const items: MemoryItem[] = JSON.parse(memory);
    if (items.length === 0) return "";
    return "\n\nWICHTIGES HINTERGRUNDWISSEN (MEMORY):\n" + 
      items.map(item => `- ${item.text}`).join('\n');
  } catch (e) {
    return "";
  }
};

export const getSettings = (): AppSettings => {
  try {
    const saved = localStorage.getItem('appSettings');
    if (saved) return JSON.parse(saved);
  } catch(e) {}
  
  const defaultPersonas: Persona[] = [
    { 
      id: '1', 
      name: 'Leyla', 
      age: '26', 
      voice: 'Kore', 
      interests: 'TikTok, Deutschrap, Apache 207', 
      hobbies: 'Konzerte, Instagram', 
      family: 'Großfamilien-Chaos', 
      socialStatus: 'Die Hype-Maus', 
      strengths: 'Streetsmart, Trends', 
      avatarColor: 'bg-rose-500',
      personalityTraits: 'Laut, Loyal, Energetisch',
      communicationStyle: 'Slang, Direkt, viele Emojis',
      expertise: 'Popkultur & Social Media'
    },
    { 
      id: '2', 
      name: 'Murat', 
      age: '29', 
      voice: 'Fenrir', 
      interests: 'Soziologie, Bourdieu, Gym', 
      hobbies: 'Lesen, Boxen', 
      family: 'Arbeiterkind', 
      socialStatus: 'Der Akademiker', 
      strengths: 'Kritisches Denken', 
      avatarColor: 'bg-blue-600',
      personalityTraits: 'Reflektiert, Bodenständig, Smart',
      communicationStyle: 'Wechselt zwischen Uni-Sprech und Straße',
      expertise: 'Klassismus & Bildung'
    },
    { 
      id: '3', 
      name: 'Sophie', 
      age: '24', 
      voice: 'Puck', 
      interests: 'Influencer Gossip, Ästhetik', 
      hobbies: 'Content Creation', 
      family: 'Single', 
      socialStatus: 'Trend Scout', 
      strengths: 'Visuelles Auge', 
      avatarColor: 'bg-purple-500',
      personalityTraits: 'Quirlig, Schnell, Organisiert',
      communicationStyle: 'Redet schnell, Storyteller',
      expertise: 'Digitale Trends & Visuals'
    },
    { 
      id: '4', 
      name: 'Jona', 
      age: '30', 
      voice: 'Zephyr', 
      interests: 'Struktur, Barrierefreiheit', 
      hobbies: 'Gaming, Schach', 
      family: 'Kleiner Kreis', 
      socialStatus: 'Der Navigator', 
      strengths: 'Geduld, Orientierung', 
      avatarColor: 'bg-emerald-500',
      personalityTraits: 'Ruhig, Hilfsbereit, Klar',
      communicationStyle: 'Präzise, nutzt Analogien, hilft bei LRS',
      expertise: 'Logik & Barrierefreiheit'
    },
    { 
      id: '5', 
      name: 'Big Mo', 
      age: '35', 
      voice: 'Charon', 
      interests: 'Old School HipHop, Kochen', 
      hobbies: 'Grillen, Vinyl', 
      family: 'Verheiratet, 2 Kinder', 
      socialStatus: 'Der Anker', 
      strengths: 'Weisheit, Chill', 
      avatarColor: 'bg-amber-600',
      personalityTraits: 'Entspannt, Beschützend, Lustig',
      communicationStyle: 'Tiefe Stimme, langsam, beruhigend',
      expertise: 'Lebensweisheiten & Musikgeschichte'
    }
  ];

  return {
    lengthDefinitions: { short: '2-3 Sätze', medium: '1 Absatz', long: 'Ausführliche Seite' },
    trainConfig: { origin: 'Göttingen', destination: 'Berlin', card: 'BahnCard 25 (2. Klasse)' },
    emailConfig: { userEmail: '', partnerEmail: '' },
    podcastConfig: {
      personas: defaultPersonas,
      activePersonaIds: ['1', '2', '4'] // Default to Leyla, Murat, Jona
    }
  };
};

export const generateImage = async (
  prompt: string, 
  aspectRatio: "1:1" | "3:4" | "4:3" | "9:16" | "16:9",
  style?: string,
  negativePrompt?: string
) => {
  const memoryContext = getUserMemory();
  
  let enhancedPrompt = prompt;
  if (style && style !== 'None') {
    enhancedPrompt = `Stil: ${style}. ${enhancedPrompt}`;
  }
  if (negativePrompt) {
    enhancedPrompt = `${enhancedPrompt} --ohne ${negativePrompt}`;
  }
  enhancedPrompt += memoryContext;

  const response = await callGeminiAPI({
    model: 'gemini-3-pro-image-preview',
    contents: { parts: [{ text: enhancedPrompt }] },
    config: {
      imageConfig: { aspectRatio }
    },
  });

  trackUsage("gemini-3-pro-image-preview", response.usageMetadata);

  for (const part of response.candidates?.[0]?.content.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return null;
};

export const chatWithSearch = async (
  message: string, 
  history: { role: 'user' | 'model', parts: { text: string }[] }[],
  deepResearch: boolean = false
) => {
  const memoryContext = getUserMemory();
  
  const model = deepResearch ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
  const config: any = {
    tools: [{ googleSearch: {} }],
    systemInstruction: deepResearch 
      ? `Du bist ein Deep Research Agent. Führe umfassende Recherchen durch. Verifiziere Fakten aus mehreren Quellen. Antworte auf Deutsch, ausführlich und präzise.${memoryContext}`
      : `Du bist ein hilfreicher Assistent. Nutze die Google Suche um akkurate Informationen zu finden. Antworte auf Deutsch.${memoryContext}`
  };

  if (deepResearch) {
    config.thinkingConfig = { thinkingBudget: 8000 };
  }
  
  const response = await callGeminiAPI({
    model: model as any,
    contents: [...history, { role: 'user', parts: [{ text: message }] }],
    config
  });

  trackUsage(model, response.usageMetadata);

  const text = response.text || "Keine Antwort erhalten.";
  const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
    uri: chunk.web?.uri || '',
    title: chunk.web?.title || 'Quelle'
  })).filter((s: any) => s.uri !== '') || [];

  return { text, sources };
};

export const processWritingTask = async (
  text: string, 
  action: 'check' | 'rephrase' | 'summarize' | 'synonyms',
  tone: Tone,
  length: Length
) => {
  const memoryContext = getUserMemory();
  const settings = getSettings();
  
  const lengthDesc = settings.lengthDefinitions[length] || length;
  
  const systemInstructions = `
    Du bist ein professioneller Schreib-Assistent für eine Nutzerin mit Lese-Rechtschreibschwäche (Dyslexie). 
    Dein Ziel: Mache die Kommunikation klar, professionell und fehlerfrei.
    Sprache: Deutsch.
    Tonfall: ${tone}
    Ziellänge: ${lengthDesc} (Halte dich strikt daran)
    Aktion: ${action === 'check' ? 'Korrigiere Grammatik/Rechtschreibung sanft, behalte die Bedeutung.' : 
             action === 'rephrase' ? 'Formuliere den Text um für besseren Fluss.' :
             action === 'summarize' ? `Fasse den Text zusammen. WICHTIG: Die Länge muss ca. ${lengthDesc} sein. Sei prägnant.` : 
             'Schlage Synonyme vor.'}
    
    Sei nicht oberlehrerhaft. Formatiere die Antwort übersichtlich.${memoryContext}
  `;

  const response = await callGeminiAPI({
    model: 'gemini-3-pro-preview',
    contents: text,
    config: {
      systemInstruction: systemInstructions,
      thinkingConfig: { thinkingBudget: 4000 }
    }
  });

  trackUsage('gemini-3-pro-preview', response.usageMetadata);
  return response.text;
};

export const runCustomPrompt = async (
  model: string,
  template: string,
  input: string,
  systemInstruction?: string,
  persona?: Persona
) => {
  const memoryContext = getUserMemory();
  const fullPrompt = template.replace('{{input}}', input);
  
  const config: any = {};
  
  let finalSystem = (systemInstruction || "Du bist ein hilfreicher Assistent.") + memoryContext;
  
  if (persona) {
    finalSystem += `\n\n[ACT AS THIS PERSONA]\nName: ${persona.name}\nAge: ${persona.age}\nRole: ${persona.socialStatus}\nPersonality Traits: ${persona.personalityTraits}\nCommunication Style: ${persona.communicationStyle}\nExpertise: ${persona.expertise}\nVoice/Tone: ${persona.voice}`;
  }

  config.systemInstruction = finalSystem;

  if (model === 'gemini-3-pro-image-preview') {
    return generateImage(fullPrompt, '1:1');
  }

  if (model === 'gemini-3-pro-preview') {
    config.thinkingConfig = { thinkingBudget: 16000 };
  }

  const response = await callGeminiAPI({
    model: model as any,
    contents: fullPrompt,
    config,
  });

  trackUsage(model, response.usageMetadata);
  return response.text;
};

export const generatePromptName = async (template: string, system: string) => {
  const response = await callGeminiAPI({
    model: 'gemini-3-flash-preview',
    contents: `Analyze this prompt template and system instruction. Generate a short, descriptive name (max 4-5 words) for this tool. 
    Template: "${template}"
    System: "${system}"
    Only return the name, nothing else.`,
  });
  
  trackUsage('gemini-3-flash-preview', response.usageMetadata);
  return response.text?.replace(/["']/g, "").trim();
};

export const generateDateIdeas = async (interests: string) => {
  const memoryContext = getUserMemory();
  const response = await callGeminiAPI({
    model: 'gemini-3-flash-preview',
    contents: `Schlage 5 kreative Wochenend-Aktivitäten vor für ein Paar in einer Fernbeziehung.
    Interessen: ${interests}
    ${memoryContext}
    Gib NUR ein JSON Array von Strings zurück, z.B. ["Kochkurs", "Wandern"].`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });

  trackUsage('gemini-3-flash-preview', response.usageMetadata);
  
  try {
    return JSON.parse(response.text || "[]");
  } catch {
    return [];
  }
};

export const analyzeCalendarImage = async (base64Data: string) => {
  const systemPrompt = `You are an expert at deciphering handwritten calendars.
  Target User: Jette (often writes in German, maybe messy handwriting).
  
  Task: Extract calendar events from this image. 
  Note: This is likely a weekly or bi-weekly overview page.
  FOCUS SPECIFICALLY ON THE WEEKENDS (Friday, Saturday, Sunday).
  
  Look for:
  - Dates (often at the top or side of columns). If year is missing, guess current or next year.
  - Event Titles (keywords: "Besuch", "Chris", "Berlin", "Date", "Konzert").
  - Times if visible.
  
  Infer 'owner':
  - If it says "Chris kommt" -> owner: 'both', type: 'visit'.
  - If it says "Uni" or "Arbeit" -> owner: 'jette', type: 'other'.
  - If it says "Chris blocked" -> owner: 'chris'.
  
  Return strictly a JSON array.`;

  const response = await callGeminiAPI({
    model: 'gemini-3-pro-preview',
    contents: {
      parts: [
        { inlineData: { data: base64Data, mimeType: 'image/jpeg' } },
        { text: "Extract weekend events. Return JSON array with: 'title', 'date' (YYYY-MM-DD), 'owner' ('chris', 'jette', 'both'), 'type' (visit/date/call/other)." }
      ]
    },
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            date: { type: Type.STRING },
            owner: { type: Type.STRING, enum: ['chris', 'jette', 'both'] },
            type: { type: Type.STRING, enum: ['visit', 'date', 'call', 'other'] }
          }
        }
      }
    }
  });

  trackUsage('gemini-3-pro-preview', response.usageMetadata);

  try {
    return JSON.parse(response.text || "[]");
  } catch {
    return [];
  }
};

export const scoutTrainTickets = async (dateRangeText: string, customOrigin?: string, customDest?: string, customCard?: string) => {
  const settings = getSettings();
  
  const origin = customOrigin || settings.trainConfig.origin || "Göttingen";
  const destination = customDest || settings.trainConfig.destination || "Berlin";
  const card = customCard || settings.trainConfig.card || "BahnCard 25";
  
  const query = `Finde verfügbare Deutsche Bahn 'Sparpreis' oder 'Super Sparpreis' Tickets für die Strecke: ${origin} nach ${destination}.
  Datum: ${dateRangeText}.
  BahnCard: ${card}.
  
  Aufgabe:
  1. Suche nach aktuellen Preisen und Verfügbarkeiten für dieses Datum.
  2. Liste 3 konkrete Verbindungen mit geschätzten Preisen.
  3. Gib mir einen Direktlink zur Buchung falls möglich.
  
  Antworte kurz und knapp auf Deutsch im Markdown Format.`;
  
  const response = await callGeminiAPI({
    model: 'gemini-3-pro-preview',
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: 4000 },
      systemInstruction: "Du bist ein Zugticket-Scout. Finde die günstigsten 'Sparpreis' Tickets."
    }
  });
  
  trackUsage('gemini-3-pro-preview', response.usageMetadata);
  return response.text;
};

// ... Excel services (kept as is) ...
export const generateExcelClarification = async (description: string) => {
  const memoryContext = getUserMemory();
  
  const response = await callGeminiAPI({
    model: 'gemini-3-flash-preview',
    contents: `Der User will eine Excel Tabelle erstellen.
    Beschreibung: "${description}"
    ${memoryContext}
    
    Stelle 3-5 klärende Fragen zur Struktur, Spalten oder Logik.
    Antworte auf Deutsch, in Stichpunkten.`,
  });
  
  trackUsage('gemini-3-flash-preview', response.usageMetadata);
  return response.text;
};

export const generateExcelExample = async (description: string, clarification: string) => {
  const memoryContext = getUserMemory();
  
  const prompt = `Erstelle eine Beispieltabelle basierend auf:
  Beschreibung: ${description}
  Details: ${clarification}
  ${memoryContext}
  
  Return ONLY a JSON object with a 'headers' array and a 'rows' array (array of arrays of strings).
  Example: { "headers": ["Datum", "Item", "Preis"], "rows": [["2024-01-01", "Kaffee", "5.00"]] }`;

  const response = await callGeminiAPI({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headers: { type: Type.ARRAY, items: { type: Type.STRING } },
          rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } }
        }
      }
    }
  });
  
  trackUsage('gemini-3-flash-preview', response.usageMetadata);
  try {
    return JSON.parse(response.text || "{}");
  } catch {
    return { headers: [], rows: [] };
  }
};

export const generateExcelFormulas = async (description: string, tableStructure: any) => {
  const prompt = `Basierend auf dieser Tabelle, erstelle die Excel Formeln.
  
  Struktur: ${JSON.stringify(tableStructure)}
  Beschreibung: ${description || "Analysiere diese Tabelle und füge Berechnungen hinzu."}
  
  Aufgabe:
  1. Identifiziere Spalten, die berechnet werden können (z.B. Summen, Durchschnitt, Gewinn, Status).
  2. Gib für jede Berechnung die exakte Excel-Formel an (Deutsche Syntax: SVERWEIS, SUMME, WENN).
  3. Erkläre kurz, was die Formel tut.
  
  Antworte auf Deutsch im Markdown Format.`;

  const response = await callGeminiAPI({
    model: 'gemini-3-pro-preview',
    contents: prompt,
    config: {
      thinkingConfig: { thinkingBudget: 4000 }
    }
  });

  trackUsage('gemini-3-pro-preview', response.usageMetadata);
  return response.text;
};
