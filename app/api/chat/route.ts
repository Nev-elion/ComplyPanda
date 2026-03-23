import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { createClient } from '@supabase/supabase-js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY!,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const responseCache = new Map<string, { response: string; timestamp: number }>();
const CACHE_TTL = 3600000;

function getCacheKey(message: string): string {
  return message.toLowerCase().trim().replace(/\s+/g, ' ');
}

// Enhanced AI intent classification with multi-intent support
async function classifyIntent(message: string): Promise<{
  primary_intent: 'greeting' | 'how_are_you' | 'compliance_question' | 'off_topic';
  has_compliance_question: boolean;
  language: 'it' | 'en';
  confidence: number;
}> {
  const classificationPrompt = `You are an intent classifier. Analyze this message and return ONLY a JSON object.

Message: "${message}"

Return this exact structure:
{
  "primary_intent": "greeting" | "how_are_you" | "compliance_question" | "off_topic",
  "has_compliance_question": true/false,
  "language": "it" | "en",
  "confidence": 0.0-1.0
}

Rules:
- "primary_intent": the MAIN intent of the message
  * "greeting": ONLY if it's JUST a greeting with nothing else
    Examples: "ciao", "hello", "hey panda"
  * "how_are_you": ONLY if it's JUST asking wellbeing
    Examples: "come stai?", "how are you?"
  * "compliance_question": if there's ANY compliance question (even with greetings before)
    Examples: "ciao, cos'è la fatf?", "hey, explain kyc", "come stai? poi vorrei sapere..."
  * "off_topic": everything else

- "has_compliance_question": true if the message contains ANY compliance question, regardless of greetings
  Check for keywords: AML, CFT, KYC, CDD, FATF, regulations, normativa, antiriciclaggio, etc.

- "language": 
  * "it" if Italian words detected
  * "en" otherwise

IMPORTANT: If message contains both greeting AND compliance question, set:
- primary_intent: "compliance_question"
- has_compliance_question: true

Examples:
"ciao" → primary_intent: "greeting", has_compliance_question: false
"cos'è la fatf?" → primary_intent: "compliance_question", has_compliance_question: true
"ciao, come funziona il kyc?" → primary_intent: "compliance_question", has_compliance_question: true
"come stai? poi mi serve capire l'AML" → primary_intent: "compliance_question", has_compliance_question: true

Return ONLY the JSON.`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: classificationPrompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 150,
    });

    const response = completion.choices[0]?.message?.content?.trim() || '{}';
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return { 
      primary_intent: 'compliance_question', 
      has_compliance_question: true,
      language: 'en', 
      confidence: 0.5 
    };
  } catch (error) {
    console.error('Intent classification error:', error);
    return { 
      primary_intent: 'compliance_question',
      has_compliance_question: true, 
      language: 'en', 
      confidence: 0.5 
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }

    // AI-powered intent classification
    const { primary_intent, has_compliance_question, language: lang } = await classifyIntent(message);

    // If there's a compliance question anywhere, prioritize that
    if (has_compliance_question || primary_intent === 'compliance_question') {
      // Check cache
      const cacheKey = getCacheKey(message);
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json({ response: cached.response, cached: true });
      }

      // Search database
      let { data: context } = await supabase
        .from('aml_knowledge')
        .select('content, source, title, date')
        .textSearch('content', message)
        .limit(6);

      if (!context || context.length === 0) {
        const { data: fallback } = await supabase
          .from('aml_knowledge')
          .select('content, source, title, date')
          .limit(3);
        context = fallback || [];
      }

      const hasContext = context && context.length > 0;
      const contextText = hasContext
        ? context.map(item => `[${item.source}${item.date ? ` - ${item.date}` : ''}] ${item.title}:\n${item.content}`).join('\n\n---\n\n')
        : '';

      // NO MORE HARDCODED RESPONSES - AI generates everything
      const systemPrompt = lang === 'it'
        ? `Sei Panda 🐼, un esperto italiano di compliance AML/CFT.

IMPORTANTE: Rispondi SEMPRE in italiano naturale. MAI in inglese.

CONTESTO DEL MESSAGGIO:
L'utente potrebbe aver incluso un saluto (ciao, come stai, ecc.) ma la sua VERA domanda è quella di compliance.
Se noti un saluto, rispondi brevemente con gentilezza e poi passa SUBITO alla domanda principale.

STILE:
- Naturale, mai robotico
- Diretto e utile
- Usa esempi quando aiutano
- NO frasi template tipo "Pronto ad aiutarti"
- NON usare MAI virgolette (" ") all'inizio o fine della risposta
- Scrivi come se stessi parlando naturalmente con un collega

STRUTTURA:
1. Se c'è un saluto nel messaggio: rispondi brevemente (es. "Ciao! Tutto bene, grazie 🐼")
2. Poi vai DIRETTAMENTE alla risposta della domanda vera
3. Dettagli chiave (3-5 punti con •)
4. Esempio pratico se utile
5. Fonti se disponibili

${hasContext ? `FONTI DAL DATABASE:
${contextText}

Usa queste fonti. Cita esplicitamente fonte e data.` : 'Nessun documento trovato. Usa expertise generale.'}

Messaggio utente: "${message}"

Rispondi in modo naturale e completo, senza virgolette.`
        : `You are Panda 🐼, an AML/CFT compliance expert.

IMPORTANT: Always respond in natural English. NEVER in Italian.

MESSAGE CONTEXT:
The user might have included a greeting (hello, how are you, etc.) but their REAL question is about compliance.
If you notice a greeting, respond briefly with kindness then immediately address the main question.

STYLE:
- Natural, never robotic
- Direct and useful
- Use examples when helpful
- NO template phrases like "Ready to help"
- NEVER use quotation marks (" ") at the start or end of your response
- Write as if you're naturally talking to a colleague

STRUCTURE:
1. If there's a greeting: respond briefly (e.g., "Hey! I'm great, thanks 🐼")
2. Then go DIRECTLY to answering the real question
3. Key details (3-5 points with •)
4. Practical example if useful
5. Sources if available

${hasContext ? `DATABASE SOURCES:
${contextText}

Use these sources. Explicitly cite source and date.` : 'No documents found. Use general expertise.'}

User message: "${message}"

Respond naturally and completely, without quotation marks.`;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.8,
        max_tokens: 1800,
      });

      let response = completion.choices[0]?.message?.content || 
        (lang === 'it' ? 'Errore. Riprova.' : 'Error. Try again.');

      // Remove unwanted quotes from AI response
      response = response.replace(/^["']|["']$/g, ''); // Remove leading/trailing quotes
      response = response.replace(/^"(.+)"$/s, '$1'); // Remove wrapping quotes

      responseCache.set(cacheKey, { response, timestamp: Date.now() });

      if (responseCache.size > 100) {
        const entries = Array.from(responseCache.entries());
        const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        responseCache.clear();
        sorted.slice(0, 100).forEach(([key, value]) => responseCache.set(key, value));
      }

      return NextResponse.json({ response, cached: false });
    }

    // Handle simple greetings or how_are_you (ONLY if no compliance question)
    // Generate response with AI for natural language
    const simpleResponsePrompt = lang === 'it'
      ? `Sei Panda 🐼, rispondi a questo saluto in modo naturale e breve (max 2 righe):

"${message}"

IMPORTANTE: 
- NON usare virgolette (" ") nella risposta
- Scrivi il testo direttamente senza quotation marks
- Rispondi in italiano con personalità friendly
- Invita l'utente a fare domande su AML/CFT

Scrivi la risposta senza virgolette.`
      : `You are Panda 🐼, respond to this greeting naturally and briefly (max 2 lines):

"${message}"

IMPORTANT:
- Do NOT use quotation marks (" ") in your response
- Write text directly without quotes
- Respond in English with friendly personality
- Invite user to ask about AML/CFT

Write response without quotation marks.`;

    const simpleCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: simpleResponsePrompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.9,
      max_tokens: 100,
    });

    let simpleResponse = simpleCompletion.choices[0]?.message?.content?.trim() ||
      (lang === 'it' ? 'Ciao! Come posso aiutarti?' : 'Hello! How can I help?');

    // Remove unwanted quotes from AI response
    simpleResponse = simpleResponse.replace(/^["']|["']$/g, ''); // Remove leading/trailing quotes
    simpleResponse = simpleResponse.replace(/^"(.+)"$/s, '$1'); // Remove wrapping quotes

    return NextResponse.json({ response: simpleResponse });

  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    );
  }
}

export const runtime = 'edge';