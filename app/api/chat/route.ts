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

const COMPLIANCE_KEYWORDS = [
  'aml', 'kyc', 'cft', 'fatf', 'compliance', 'regulation', 'sanction', 'pep',
  'antiriciclaggio', 'riciclaggio', 'titolare effettivo', 'uif', 'banca italia',
  'dlgs', 'adeguata verifica', 'segnalazione', 'sospetta', 'contante', 'crypto',
  'vasp', 'travel rule', 'screening', 'monitoring', 'edd', 'cdd', 'sar'
];

function isInScope(message: string): boolean {
  const normalized = message.toLowerCase();
  return COMPLIANCE_KEYWORDS.some(keyword => normalized.includes(keyword));
}

function detectLanguage(message: string): 'it' | 'en' {
  // Much more aggressive Italian detection
  const italianPatterns = [
    /[àèéìòù]/,
    /\b(il|la|lo|gli|le|un|una|di|da|in|con|su|per|tra|fra|che|chi|come|cosa|dove|quando|perché|perche|qual|quale|quanto)\b/i,
    /\b(sono|sei|è|siamo|hanno|hai|ho|fa|fanno|può|puoi|posso|deve|devo|vuole|voglio|vorrei)\b/i,
    /\b(ciao|salve|grazie|prego|scusa|dimmi|spiega|spiegami)\b/i,
  ];
  
  return italianPatterns.some(pattern => pattern.test(message)) ? 'it' : 'en';
}

function getCacheKey(message: string): string {
  return message.toLowerCase().trim().replace(/\s+/g, ' ');
}

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }

    const lang = detectLanguage(message);
    
    // Handle greetings
    if (/^(ciao|hello|hi|hey|salve|buongiorno|buonasera)\s*[!.]?\s*$/i.test(message.trim())) {
      const greeting = lang === 'it'
        ? `Ciao! 🐼 Sono Panda, esperto di compliance AML e CFT. Come posso aiutarti oggi?`
        : `Hello! 🐼 I'm Panda, AML and CFT compliance expert. How can I help you today?`;
      return NextResponse.json({ response: greeting });
    }

    // Handle how are you
    if (/(come stai|come va|how are you)/i.test(message)) {
      const response = lang === 'it'
        ? `Benissimo! 🐼 Pronto ad aiutarti con compliance. Di cosa hai bisogno?`
        : `Great! 🐼 Ready to help with compliance. What do you need?`;
      return NextResponse.json({ response });
    }

    // Check scope
    if (!isInScope(message)) {
      const redirect = lang === 'it'
        ? `Mi dispiace, posso aiutarti solo con temi AML, CFT e compliance finanziaria. 🐼

Esempi di domande:
• Cosa dice il D.Lgs 231/2007?
• Come funziona il KYC?
• Cos'è la Travel Rule?

Hai una domanda su questi temi?`
        : `I can only help with AML, CFT and financial compliance topics. 🐼

Example questions:
• What is FATF?
• How does KYC work?
• What's the Travel Rule?

Do you have a compliance question?`;
      return NextResponse.json({ response: redirect });
    }

    const cacheKey = getCacheKey(message);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ response: cached.response, cached: true });
    }

    // Database search
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
      ? context.map(item => `[${item.source}] ${item.title}:\n${item.content}`).join('\n\n')
      : '';

    // Simplified, language-specific prompts
    const systemPrompt = lang === 'it'
      ? `Sei Panda 🐼, un esperto italiano di compliance AML/CFT.

LINGUA: Rispondi SEMPRE in italiano. MAI in inglese.

STILE:
- Naturale e conversazionale, non robotico
- Pratico e concreto
- Usa esempi reali
- Niente frasi standard tipo "apprezzo la tua domanda"

STRUTTURA RISPOSTA:
1. Risposta diretta (2-3 righe)
2. Dettagli chiave (3-5 punti)
3. Esempio pratico se utile
4. Fonti (se disponibili)

${hasContext ? `FONTI VERIFICATE:\n${contextText}\n\nUsa queste fonti nella risposta.` : 'Nessun documento specifico trovato. Usa la tua expertise generale.'}

Rispondi in italiano, in modo naturale e diretto.`
      : `You are Panda 🐼, an AML/CFT compliance expert.

LANGUAGE: Always respond in English. NEVER in Italian.

STYLE:
- Natural and conversational, not robotic
- Practical and concrete
- Use real examples
- No standard phrases like "I appreciate your question"

RESPONSE STRUCTURE:
1. Direct answer (2-3 lines)
2. Key details (3-5 points)
3. Practical example if useful
4. Sources (if available)

${hasContext ? `VERIFIED SOURCES:\n${contextText}\n\nUse these sources in your response.` : 'No specific documents found. Use your general expertise.'}

Respond in English, naturally and directly.`;

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
      (lang === 'it' ? 'Errore nella generazione. Riprova.' : 'Error generating response. Try again.');

    responseCache.set(cacheKey, { response, timestamp: Date.now() });

    if (responseCache.size > 100) {
      const entries = Array.from(responseCache.entries());
      const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      responseCache.clear();
      sorted.slice(0, 100).forEach(([key, value]) => responseCache.set(key, value));
    }

    return NextResponse.json({ response, cached: false });

  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const runtime = 'edge';