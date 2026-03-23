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
const CACHE_TTL = 3600000; // 1 hour

function getCacheKey(message: string): string {
  return message.toLowerCase().trim().replace(/\s+/g, ' ');
}

// AI-powered intent classification
async function classifyIntent(message: string): Promise<{
  intent: 'greeting' | 'how_are_you' | 'compliance_question' | 'off_topic';
  language: 'it' | 'en';
  confidence: number;
}> {
  const classificationPrompt = `You are an intent classifier. Analyze this message and return ONLY a JSON object.

Message: "${message}"

Return this exact structure:
{
  "intent": "greeting" | "how_are_you" | "compliance_question" | "off_topic",
  "language": "it" | "en",
  "confidence": 0.0-1.0
}

Rules:
- "greeting": any hello/hi/ciao/salve variations (even with extra letters, punctuation, or "panda" after)
  Examples: "ciao", "ciaooo", "hello panda", "hey!!!", "yooo", "wassup"
- "how_are_you": asking about wellbeing
  Examples: "come stai", "how are you", "come va", "tutto bene", "sup"
- "compliance_question": anything related to:
  * AML, CFT, KYC, CDD, EDD
  * Regulations, laws, directives (FATF, 5AMLD, 6AMLD, MiCA, D.Lgs 231)
  * Banking, financial services, crypto compliance
  * Sanctions, PEP, screening, monitoring
  * Money laundering, terrorist financing
  * Italian compliance (UIF, Banca d'Italia, GdF)
  Examples: "cos'è la fatf", "explain kyc", "come funziona", "normativa italiana"
- "off_topic": everything else
  Examples: "weather", "recipes", "sports", "history", "what's 2+2"
- "language": 
  * "it" if Italian (check words like: è, di, che, come, cosa, per, con, su, sono, hai, può, etc)
  * "en" if English

Return ONLY the JSON, nothing else.`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: classificationPrompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 100,
    });

    const response = completion.choices[0]?.message?.content?.trim() || '{}';
    
    // Extract JSON (handle cases where model adds extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback
    return { intent: 'compliance_question', language: 'en', confidence: 0.5 };
  } catch (error) {
    console.error('Intent classification error:', error);
    // Default to compliance question if classification fails
    return { intent: 'compliance_question', language: 'en', confidence: 0.5 };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }

    // Step 1: AI-powered intent classification
    const { intent, language: lang } = await classifyIntent(message);

    // Step 2: Handle based on intent
    switch (intent) {
      case 'greeting':
        const greeting = lang === 'it'
          ? `Ciao! 🐼 Sono Panda, esperto di compliance AML e CFT. Come posso aiutarti oggi?`
          : `Hello! 🐼 I'm Panda, AML and CFT compliance expert. How can I help you today?`;
        return NextResponse.json({ response: greeting });

      case 'how_are_you':
        const howResponse = lang === 'it'
          ? `Benissimo, grazie! 🐼 Pronto ad aiutarti con compliance. Di cosa hai bisogno?`
          : `Great, thanks! 🐼 Ready to help with compliance. What do you need?`;
        return NextResponse.json({ response: howResponse });

      case 'off_topic':
        const redirect = lang === 'it'
          ? `Mi dispiace, posso aiutarti solo con temi AML, CFT e compliance finanziaria. 🐼

Esempi di domande:
• Cosa dice il D.Lgs 231/2007?
• Come funziona il KYC?
• Cos'è la Travel Rule?
• Come si fa una segnalazione SOS?

Hai una domanda su questi temi?`
          : `I can only help with AML, CFT and financial compliance topics. 🐼

Example questions:
• What is FATF?
• How does KYC work?
• What's the Travel Rule?
• How to file a SAR?

Do you have a compliance question?`;
        return NextResponse.json({ response: redirect });

      case 'compliance_question':
        // Check cache first
        const cacheKey = getCacheKey(message);
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          return NextResponse.json({ response: cached.response, cached: true });
        }

        // Search database for relevant context
        let { data: context } = await supabase
          .from('aml_knowledge')
          .select('content, source, title, date')
          .textSearch('content', message)
          .limit(6);

        // Fallback search if no results
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

        // Language-specific system prompt
        const systemPrompt = lang === 'it'
          ? `Sei Panda 🐼, un esperto italiano di compliance AML/CFT.

LINGUA: Rispondi SEMPRE in italiano. MAI in inglese.

STILE:
- Naturale e conversazionale, mai robotico
- Pratico e concreto
- Usa esempi reali quando utile
- Evita frasi standard tipo "apprezzo la domanda"
- Sii diretto e chiaro

STRUTTURA RISPOSTA:
1. Risposta diretta e concisa (2-3 righe)
2. Dettagli chiave (3-5 punti con • bullet points)
3. Esempio pratico se utile
4. Cita le fonti se disponibili

${hasContext ? `FONTI VERIFICATE DAL DATABASE:
${contextText}

Usa queste fonti nella tua risposta. Cita esplicitamente fonte e data quando disponibili.` : 'Nessun documento specifico trovato. Usa la tua expertise generale su compliance AML/CFT.'}

Rispondi in italiano, in modo naturale e utile.`
          : `You are Panda 🐼, an AML/CFT compliance expert.

LANGUAGE: Always respond in English. NEVER in Italian.

STYLE:
- Natural and conversational, never robotic
- Practical and concrete
- Use real examples when helpful
- Avoid standard phrases like "I appreciate your question"
- Be direct and clear

RESPONSE STRUCTURE:
1. Direct, concise answer (2-3 lines)
2. Key details (3-5 points with • bullet points)
3. Practical example if useful
4. Cite sources if available

${hasContext ? `VERIFIED SOURCES FROM DATABASE:
${contextText}

Use these sources in your response. Explicitly cite source and date when available.` : 'No specific documents found. Use your general AML/CFT compliance expertise.'}

Respond in English, naturally and helpfully.`;

        // Generate response using LLM
        const completion = await groq.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.8,
          max_tokens: 1500,
        });

        const response = completion.choices[0]?.message?.content || 
          (lang === 'it' ? 'Mi dispiace, errore nella generazione. Riprova.' : 'Sorry, error generating response. Try again.');

        // Cache the response
        responseCache.set(cacheKey, { response, timestamp: Date.now() });

        // Clean cache if too large
        if (responseCache.size > 100) {
          const entries = Array.from(responseCache.entries());
          const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
          responseCache.clear();
          sorted.slice(0, 100).forEach(([key, value]) => responseCache.set(key, value));
        }

        return NextResponse.json({ response, cached: false });

      default:
        const fallbackMsg = lang === 'it'
          ? 'Non ho capito la tua richiesta. Puoi riformulare?'
          : 'I could not understand your request. Can you rephrase?';
        return NextResponse.json({ response: fallbackMsg });
    }

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