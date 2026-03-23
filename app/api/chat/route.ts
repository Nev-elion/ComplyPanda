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

// ========================================
// HELPER FUNCTIONS - Web Search & API
// ========================================

function shouldSearchWeb(message: string): boolean {
  const triggers = [
    'ultime', 'recenti', 'aggiornamenti', 'nuove', 'latest', 'recent', 'new',
    'comunicazione', 'provvedimento', 'circolare', 'parere',
    '2024', '2025', '2026',
    'oggi', 'yesterday', 'settimana', 'week', 'mese', 'month',
  ];
  return triggers.some(trigger => message.toLowerCase().includes(trigger));
}

function shouldQueryAPIs(message: string): boolean {
  const triggers = [
    'sanzione', 'sanctioned', 'pep', 'politically exposed',
    'lista', 'blacklist', 'sdn', 'ofac',
    'società', 'company', 'azienda', 'impresa',
    'è sanzionata', 'is sanctioned', 'check',
  ];
  return triggers.some(trigger => message.toLowerCase().includes(trigger));
}

function detectQueryType(message: string): string {
  if (/sanzione|sanction|lista|blacklist|sdn|ofac/i.test(message)) return 'sanctions';
  if (/società|company|azienda|impresa|firm/i.test(message)) return 'company';
  if (/normativa|legge|direttiva|regolamento|directive|regulation/i.test(message)) return 'legislation';
  return 'all';
}

function extractEntityName(message: string): string {
  // Estrai nome tra virgolette
  const quoted = message.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  
  // Cerca dopo parole chiave
  const afterCheck = message.match(/(?:check|verifica|controlla|cerca)\s+([A-Z][a-zA-Z\s&.,]+?)(?:\s+(?:è|is|nella|in|sul))/i);
  if (afterCheck) return afterCheck[1].trim();
  
  // Fallback: prendi parole capitalizzate
  const words = message.split(' ').filter(w => /^[A-Z]/.test(w));
  if (words.length > 0) return words.slice(-3).join(' ');
  
  return message.split(' ').slice(0, 5).join(' '); // Fallback totale
}

// ========================================
// AI INTENT CLASSIFICATION
// ========================================

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

// ========================================
// MAIN ROUTE HANDLER
// ========================================

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

      // ========================================
      // 1. SEARCH DATABASE
      // ========================================
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

      // ========================================
      // 2. SEARCH WEB (if needed)
      // ========================================
      let webContext = '';
      if (shouldSearchWeb(message)) {
        try {
          console.log('🌐 Triggering web search...');
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://comply-panda.vercel.app/';
          const webResponse = await fetch(`${baseUrl}/api/search-external`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: message }),
          });
          
          if (webResponse.ok) {
            const webData = await webResponse.json();
            
            if (webData.content && webData.content.length > 0) {
              webContext = webData.content
                .map((item: any) => `[WEB - ${item.source}] ${item.title}\n${item.content}`)
                .join('\n\n---\n\n');
              console.log(`✅ Found ${webData.content.length} web results`);
            }
          }
        } catch (error) {
          console.error('❌ Web search error:', error);
        }
      }

      // ========================================
      // 3. QUERY EXTERNAL APIs (if needed)
      // ========================================
      let apiContext = '';
      if (shouldQueryAPIs(message)) {
        try {
          console.log('🔍 Querying external APIs...');
          const entityName = extractEntityName(message);
          const queryType = detectQueryType(message);
          
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://comply-panda.vercel.app/';
          const apiResponse = await fetch(`${baseUrl}/api/external-apis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: entityName,
              type: queryType,
            }),
          });
          
          if (apiResponse.ok) {
            const apiData = await apiResponse.json();
            
            if (apiData.results && apiData.results.length > 0) {
              apiContext = apiData.results
                .map((item: any) => {
                  const dataStr = typeof item.data === 'object' 
                    ? JSON.stringify(item.data, null, 2).substring(0, 1000)
                    : String(item.data).substring(0, 1000);
                  return `[API - ${item.source}]\n${dataStr}`;
                })
                .join('\n\n---\n\n');
              console.log(`✅ Found ${apiData.results.length} API results`);
            }
          }
        } catch (error) {
          console.error('❌ API query error:', error);
        }
      }

      // ========================================
      // 4. COMBINE ALL CONTEXTS
      // ========================================
      const dbContext = context && context.length > 0
        ? context.map(item => `[DB - ${item.source}${item.date ? ` - ${item.date}` : ''}] ${item.title}:\n${item.content}`).join('\n\n---\n\n')
        : '';

      const allContexts = [dbContext, webContext, apiContext].filter(Boolean);
      const hasContext = allContexts.length > 0;
      const contextText = allContexts.join('\n\n━━━━━━ ADDITIONAL SOURCES ━━━━━━\n\n');

      // ========================================
      // 5. GENERATE AI RESPONSE
      // ========================================
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
5. Fonti: cita esplicitamente [DB - fonte], [WEB - fonte], [API - fonte] quando usi informazioni

${hasContext ? `FONTI DISPONIBILI:
${contextText}

Usa queste fonti. Cita esplicitamente fonte e tipo (DB/WEB/API) quando fornisci informazioni.
Se ci sono risultati WEB, sono le informazioni PIÙ RECENTI.
Se ci sono risultati API, sono verifiche REAL-TIME su liste sanctions/companies.` : 'Nessun documento trovato. Usa expertise generale AML/CFT.'}

Messaggio utente: "${message}"

Rispondi in modo naturale e completo, senza virgolette. Cita le fonti quando usi informazioni specifiche.`
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
5. Sources: explicitly cite [DB - source], [WEB - source], [API - source] when using information

${hasContext ? `AVAILABLE SOURCES:
${contextText}

Use these sources. Explicitly cite source and type (DB/WEB/API) when providing information.
If there are WEB results, they are the MOST RECENT information.
If there are API results, they are REAL-TIME verifications on sanctions/company lists.` : 'No documents found. Use general AML/CFT expertise.'}

User message: "${message}"

Respond naturally and completely, without quotation marks. Cite sources when using specific information.`;

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

      // Remove unwanted quotes - ES2017 compatible
      response = response.replace(/^["']|["']$/g, '');
      if (response.startsWith('"') && response.endsWith('"')) {
        response = response.slice(1, -1);
      }
      if (response.startsWith("'") && response.endsWith("'")) {
        response = response.slice(1, -1);
      }

      // Cache response
      responseCache.set(cacheKey, { response, timestamp: Date.now() });

      // Clean cache if too large
      if (responseCache.size > 100) {
        const entries = Array.from(responseCache.entries());
        const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        responseCache.clear();
        sorted.slice(0, 100).forEach(([key, value]) => responseCache.set(key, value));
      }

      return NextResponse.json({ response, cached: false });
    }

    // ========================================
    // HANDLE SIMPLE GREETINGS
    // ========================================
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

    // Remove unwanted quotes
    simpleResponse = simpleResponse.replace(/^["']|["']$/g, '');
    if (simpleResponse.startsWith('"') && simpleResponse.endsWith('"')) {
      simpleResponse = simpleResponse.slice(1, -1);
    }
    if (simpleResponse.startsWith("'") && simpleResponse.endsWith("'")) {
      simpleResponse = simpleResponse.slice(1, -1);
    }

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