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
// SIMPLE HELPERS
// ========================================

function shouldSearchWeb(message: string): boolean {
  // SEMPRE cerca sul web per domande compliance
  return true;
}

function shouldQueryAPIs(message: string): boolean {
  const triggers = ['sanzione', 'sanctioned', 'pep', 'lista', 'blacklist', 'sdn', 'ofac', 'grey list'];
  return triggers.some(t => message.toLowerCase().includes(t));
}

// ========================================
// AI INTENT CLASSIFICATION
// ========================================

async function classifyIntent(message: string): Promise<{
  primary_intent: 'greeting' | 'compliance_question' | 'off_topic';
  has_compliance_question: boolean;
  language: 'it' | 'en';
}> {
  const messageLower = message.toLowerCase();
  
  // Simple heuristic classification
  const complianceKeywords = [
    'aml', 'cft', 'kyc', 'cdd', 'edd', 'pep', 'fatf', 'uif', 'eba',
    'antiriciclaggio', 'riciclaggio', 'compliance', 'normativa',
    'ultime', 'notizie', 'news', 'indicatori', 'procedure', 'obblighi',
  ];
  
  const hasComplianceKeyword = complianceKeywords.some(kw => messageLower.includes(kw));
  
  if (hasComplianceKeyword) {
    return {
      primary_intent: 'compliance_question',
      has_compliance_question: true,
      language: messageLower.match(/\b(the|is|are|what|how)\b/) ? 'en' : 'it',
    };
  }
  
  if (/^(ciao|hello|hi|hey|buongiorno|salve)$/i.test(messageLower.trim())) {
    return {
      primary_intent: 'greeting',
      has_compliance_question: false,
      language: messageLower.match(/hello|hi|hey/) ? 'en' : 'it',
    };
  }
  
  return {
    primary_intent: 'compliance_question',
    has_compliance_question: true,
    language: 'it',
  };
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

    const { primary_intent, has_compliance_question, language: lang } = await classifyIntent(message);

    if (has_compliance_question || primary_intent === 'compliance_question') {
      const cacheKey = getCacheKey(message);
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return NextResponse.json({ response: cached.response, cached: true });
      }

      console.log(`\n💬 Compliance question: "${message}"`);
      console.log(`🌐 Language: ${lang}`);

      // ========================================
      // SEARCH: DB + WEB in PARALLEL
      // ========================================
      
      const startTime = Date.now();
      
      // Database search (limited, quick)
      const dbPromise = supabase
        .from('aml_knowledge')
        .select('content, source, title, date')
        .textSearch('content', message)
        .order('date', { ascending: false })
        .limit(3);

      // Web search (ALWAYS)
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://comply-panda.vercel.app';
      const webPromise = fetch(`${baseUrl}/api/search-external`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: message }),
      }).then(r => r.ok ? r.json() : null);

      // API search (conditional)
      let apiPromise = Promise.resolve(null);
      if (shouldQueryAPIs(message)) {
        apiPromise = fetch(`${baseUrl}/api/external-apis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: message, type: 'all' }),
        }).then(r => r.ok ? r.json() : null);
      }

      // Wait for all searches
      const [dbResult, webResult, apiResult] = await Promise.all([
        dbPromise,
        webPromise,
        apiPromise,
      ]);

      const searchTime = Date.now() - startTime;
      console.log(`⏱️  Search completed in ${searchTime}ms`);

      // ========================================
      // BUILD CONTEXT
      // ========================================
      
      const dbContext = dbResult.data || [];
      const webContent = (webResult as any)?.content || [];
      const apiContent = (apiResult as any)?.results || [];

      console.log(`📊 Sources found:`);
      console.log(`  - DB: ${dbContext.length}`);
      console.log(`  - Web: ${webContent.length}`);
      console.log(`  - API: ${apiContent.length}`);

      // Build rich context string
      let contextParts: string[] = [];

      // WEB first (most important for "ultime notizie")
      if (webContent.length > 0) {
        contextParts.push('=== WEB SOURCES (MOST RECENT) ===\n');
        webContent.forEach((item: any, idx: number) => {
          contextParts.push(
            `[${idx + 1}] ${item.source} - ${item.title}\n` +
            `URL: ${item.url}\n` +
            `Content: ${item.content.substring(0, 800)}\n\n`
          );
        });
      }

      // API results
      if (apiContent.length > 0) {
        contextParts.push('=== API RESULTS (REAL-TIME DATA) ===\n');
        apiContent.forEach((item: any, idx: number) => {
          const data = typeof item.data === 'object' ? JSON.stringify(item.data) : item.data;
          contextParts.push(`[API-${idx + 1}] ${item.source}: ${data.substring(0, 500)}\n\n`);
        });
      }

      // DB last (general knowledge)
      if (dbContext.length > 0) {
        contextParts.push('=== DATABASE (GENERAL KNOWLEDGE) ===\n');
        dbContext.forEach((item: any, idx: number) => {
          contextParts.push(
            `[DB-${idx + 1}] ${item.source} - ${item.title}\n` +
            `Content: ${item.content.substring(0, 600)}\n\n`
          );
        });
      }

      const hasContext = contextParts.length > 0;
      const fullContext = contextParts.join('');

      // ========================================
      // GENERATE RESPONSE - Natural Style
      // ========================================

      const systemPrompt = lang === 'it'
        ? `Sei Panda 🐼, un assistente AI esperto in compliance AML/CFT.

**STILE DI RISPOSTA:**
- Naturale e conversazionale
- Diretto ed efficace
- Umano, mai robotico
- Usa un tono professionale ma amichevole

**COME RISPONDERE:**

Se l'utente chiede "ultime notizie" o info recenti:
- Inizia con: "Ho trovato alcune notizie recenti interessanti:"
- Elenca 3-4 punti principali dalle fonti WEB (le più aggiornate)
- Menziona le fonti in modo naturale: "Secondo [fonte]..." o "Su [sito] leggo che..."
- Alla fine aggiungi link: "Puoi approfondire qui: [link]"

Per domande specifiche (es. "cos'è la CDD"):
- Definizione chiara e breve
- 3-4 punti chiave
- Esempio pratico se utile
- Riferimenti alle fonti quando pertinenti

**IMPORTANTISSIMO:**
- NON usare MAI bullet points secchi tipo "• Punto 1"
- NON scrivere come un elenco telegrafico
- Scrivi come se stessi parlando a un collega
- Usa paragrafi e frasi complete
- Temperature alta = risposte varie e naturali

${hasContext ? `**FONTI DISPONIBILI:**
${fullContext}

**COME USARE LE FONTI:**
- Le fonti WEB sono le PIÙ RECENTI → usale per notizie e aggiornamenti
- Le fonti API sono REAL-TIME → usale per verifiche (sanctions, PEP, etc)
- Le fonti DB sono CONOSCENZA GENERALE → usale solo se WEB/API insufficienti

Menziona le fonti in modo naturale nel testo, non con numeri (1)(2)(3).
Esempio: "Secondo un recente articolo su Il Sole 24 Ore..." invece di "(1)"` : 
`**NESSUNA FONTE DISPONIBILE**

Rispondi comunque usando la tua conoscenza generale su AML/CFT, ma specifica:
"Non ho trovato fonti aggiornate al momento, ma posso dirti che..."

Suggerisci di consultare: bancaditalia.it, uif.bancaditalia.it, fatf-gafi.org`}

**DOMANDA UTENTE:**
"${message}"

Rispondi in modo naturale, completo e utile.`
        : `You are Panda 🐼, an AI assistant expert in AML/CFT compliance.

**RESPONSE STYLE:**
- Natural and conversational
- Direct and effective
- Human, never robotic
- Professional but friendly tone

**HOW TO RESPOND:**

For "latest news" or recent info:
- Start with: "I found some interesting recent news:"
- List 3-4 main points from WEB sources (most updated)
- Mention sources naturally: "According to [source]..." or "On [site] I read that..."
- Add links at the end: "You can learn more here: [link]"

For specific questions (e.g., "what is CDD"):
- Clear and brief definition
- 3-4 key points
- Practical example if useful
- Source references when relevant

**VERY IMPORTANT:**
- NEVER use dry bullet points like "• Point 1"
- DON'T write as a telegraphic list
- Write as if talking to a colleague
- Use paragraphs and complete sentences
- High temperature = varied and natural responses

${hasContext ? `**AVAILABLE SOURCES:**
${fullContext}

**HOW TO USE SOURCES:**
- WEB sources are MOST RECENT → use for news and updates
- API sources are REAL-TIME → use for checks (sanctions, PEP, etc)
- DB sources are GENERAL KNOWLEDGE → use only if WEB/API insufficient

Mention sources naturally in text, not with numbers (1)(2)(3).
Example: "According to a recent article on Il Sole 24 Ore..." instead of "(1)"` :
`**NO SOURCES AVAILABLE**

Answer using your general AML/CFT knowledge, but specify:
"I didn't find updated sources at the moment, but I can tell you that..."

Suggest consulting: bancaditalia.it, uif.bancaditalia.it, fatf-gafi.org`}

**USER QUESTION:**
"${message}"

Respond naturally, completely, and helpfully.`;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.95,
        max_tokens: 2000,
        top_p: 0.9,
      });

      let response = completion.choices[0]?.message?.content || 
        (lang === 'it' ? 'Mi dispiace, c\'è stato un errore. Riprova.' : 'Sorry, there was an error. Try again.');

      // Clean response
      response = response.replace(/^["']|["']$/g, '').trim();

      // Cache
      responseCache.set(cacheKey, { response, timestamp: Date.now() });

      if (responseCache.size > 100) {
        const entries = Array.from(responseCache.entries());
        const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        responseCache.clear();
        sorted.slice(0, 100).forEach(([key, value]) => responseCache.set(key, value));
      }

      console.log(`✅ Response generated (${response.length} chars)`);

      return NextResponse.json({ response, cached: false });
    }

    // ========================================
    // HANDLE GREETINGS
    // ========================================
    const greetingPrompt = lang === 'it'
      ? `Rispondi a questo saluto in modo amichevole e breve (max 2 righe): "${message}"\n\nInvita a fare domande su AML/CFT. Stile naturale e conversazionale.`
      : `Respond to this greeting friendly and briefly (max 2 lines): "${message}"\n\nInvite to ask about AML/CFT. Natural conversational style.`;

    const greetingCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: greetingPrompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.95,
      max_tokens: 100,
    });

    let greetingResponse = greetingCompletion.choices[0]?.message?.content?.trim() ||
      (lang === 'it' ? 'Ciao! Come posso aiutarti?' : 'Hello! How can I help?');

    greetingResponse = greetingResponse.replace(/^["']|["']$/g, '').trim();

    return NextResponse.json({ response: greetingResponse });

  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';