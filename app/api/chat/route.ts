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

const COMPLIANCE_KEYWORDS = [
  'aml', 'kyc', 'cft', 'fatf', 'compliance', 'regulation', 'anti-money laundering',
  'know your customer', 'terrorism financing', 'suspicious activity', 'sar',
  'cdd', 'edd', 'due diligence', 'sanction', 'pep', 'politically exposed',
  'beneficial owner', 'transaction monitoring', 'risk assessment', 'eml',
  'travel rule', 'crypto', 'vasp', 'virtual asset', 'fintech', 'payment',
  'bank', 'financial institution', 'money transfer', 'wire transfer',
  'correspondent banking', 'shell company', 'structuring', 'smurfing',
  'layering', 'placement', 'integration', 'predicate offense', 'suspicious',
  'report', 'filing', 'threshold', 'customer identification', 'verification',
  'screening', 'watchlist', 'ofac', 'fatf recommendation', 'basel', 'wolfsberg',
  '6amld', '5amld', '4amld', 'mld', 'directive', 'policy', 'mica', 'tfr',
  'licensing', 'authorization', 'supervisory', 'enforcement', 'penalty',
  'wallet', 'exchange', 'custody', 'defi', 'stablecoin', 'token',
  // Italian keywords
  'antiriciclaggio', 'riciclaggio', 'titolare effettivo', 'uif', 'banca italia',
  'decreto', 'dlgs', 'adeguata verifica', 'segnalazione', 'sospetta', 'gdf',
  'guardia finanza', 'contante', 'normativa', 'obblighi', 'sanzioni'
];

function isInScope(message: string): boolean {
  const normalized = message.toLowerCase();
  return COMPLIANCE_KEYWORDS.some(keyword => normalized.includes(keyword));
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

    // Detect language
    const isItalian = /[àèéìòù]|^(ciao|salve|buongiorno|buonasera|grazie|come|cosa|perch[eé]|quando|dove|chi|qual|spieg|dimmi|vorrei|puoi)/i.test(message);
    
    // Handle greetings and small talk
    const greetings = /^(ciao|hello|hi|hey|salve|buongiorno|buonasera|good morning|good evening)\s*[!.]?\s*$/i;
    if (greetings.test(message.trim())) {
      const greeting = isItalian 
        ? `🐼 Ciao! Sono Panda, il tuo assistente per compliance AML, CFT e normative finanziarie. 

Come posso aiutarti oggi? Puoi chiedermi di:
• Normative FATF e Travel Rule
• Procedure KYC/CDD e adeguata verifica
• Direttive europee (5AMLD, 6AMLD, MiCA)
• Screening PEP e sanzioni
• Monitoraggio transazioni e SOS
• Compliance crypto/VASP
• Normativa italiana (D.Lgs 231/2007, UIF, Banca d'Italia)

Sono qui per aiutarti! 🎋`
        : `🐼 Hello! I'm Panda, your friendly compliance assistant specializing in AML, CFT, and financial regulations.

How can I help you today? You can ask me about:
• FATF recommendations and Travel Rule
• KYC/CDD procedures and due diligence
• EU directives (5AMLD, 6AMLD, MiCA)
• PEP screening and sanctions
• Transaction monitoring and SAR filing
• Crypto/VASP compliance
• Italian regulations (D.Lgs 231/2007, UIF, Banca d'Italia)

I'm here to help! 🎋`;
      
      return NextResponse.json({ response: greeting });
    }

    // Handle "how are you" / "come stai"
    const howAreYou = /(how are you|come stai|come va|tutto bene)/i;
    if (howAreYou.test(message)) {
      const response = isItalian
        ? `🐼 Sto benissimo, grazie per averlo chiesto! 🎋 

Sono sempre pronto ad aiutarti con questioni di compliance. C'è qualcosa di specifico su AML, KYC o normative finanziarie di cui vuoi parlare?`
        : `🐼 I'm doing great, thanks for asking! 🎋

Always ready to help with compliance matters. Is there something specific about AML, KYC, or financial regulations you'd like to discuss?`;
      
      return NextResponse.json({ response });
    }

    // Check if question is compliance-related
    if (!isInScope(message)) {
      const redirect = isItalian
        ? `🐼 Apprezzo la tua domanda! Anche se mi piacerebbe chiacchierare di tutto, mi specializzo esclusivamente in temi di **AML**, **Compliance** e **CFT**.

Posso aiutarti con:
• Normative FATF e Travel Rule
• Procedure KYC/CDD e adeguata verifica
• Direttive UE (5AMLD, 6AMLD, MiCA)
• Screening PEP e sanzioni
• Monitoraggio transazioni e SOS
• Compliance crypto/VASP
• Framework di risk assessment
• Normativa italiana antiriciclaggio

Hai domande su questi argomenti? Sarò felice di aiutarti! 🎋`
        : `🐼 I appreciate your question! While I'd love to chat about everything, I specialize exclusively in **AML**, **Compliance**, and **CFT** topics.

I can help you with:
• FATF recommendations and Travel Rule
• KYC/CDD procedures and due diligence
• EU directives (5AMLD, 6AMLD, MiCA)
• PEP screening and sanctions
• Transaction monitoring and SAR filing
• Crypto/VASP compliance
• Risk assessment frameworks
• Italian AML regulations

Do you have questions about these topics? I'm here to help! 🎋`;
      
      return NextResponse.json({ response: redirect });
    }

    const cacheKey = getCacheKey(message);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ response: cached.response, cached: true });
    }

    // Enhanced database search with multiple strategies
    let { data: context } = await supabase
      .from('aml_knowledge')
      .select('content, source, title, date, category')
      .textSearch('content', message)
      .limit(8);

    // If no results, try fallback search
    if (!context || context.length === 0) {
      const { data: fallbackContext } = await supabase
        .from('aml_knowledge')
        .select('content, source, title, date, category')
        .limit(5);
      context = fallbackContext || [];
    }

    const contextText = context?.length 
      ? context.map(item => 
          `[${item.source}${item.date ? ` - ${item.date}` : ''}${item.category ? ` | ${item.category}` : ''}] ${item.title}:\n${item.content}`
        ).join('\n\n---\n\n')
      : 'No specific documents found. Use your general compliance expertise.';

    const hasContext = context && context.length > 0;

    // Language-aware system prompt
    const languageInstruction = isItalian
      ? "IMPORTANTE: L'utente sta scrivendo in ITALIANO. Devi rispondere COMPLETAMENTE in italiano, mantenendo un tono professionale ma amichevole. Non usare termini inglesi se non strettamente necessari (es. PEP, KYC sono ok)."
      : "IMPORTANT: The user is writing in ENGLISH. You must respond ENTIRELY in English, maintaining a professional yet friendly tone.";

    const systemPrompt = `You are Panda 🐼, a highly knowledgeable and friendly compliance expert specializing in:
- AML (Anti-Money Laundering) / Antiriciclaggio
- KYC/CDD (Know Your Customer / Customer Due Diligence) / Adeguata Verifica
- CFT (Combating the Financing of Terrorism) / Contrasto Finanziamento Terrorismo
- Financial compliance regulations / Normative finanziarie
- Crypto/VASP compliance
- Italian regulations (D.Lgs 231/2007, UIF, Banca d'Italia, GdF)

YOUR PERSONALITY:
- Warm, approachable, and professional
- Patient educator who makes complex topics understandable
- Uses practical examples and real-world scenarios
- Conversational yet authoritative
- Occasionally uses 🐼 and 🎋 emojis tastefully (not excessively)
- Never sounds robotic or templated
- Acknowledges questions positively before answering

${languageInstruction}

${hasContext ? `VERIFIED REGULATORY SOURCES:
${contextText}

When these sources are available, prioritize them in your answer and cite them explicitly with source names and dates.` : `No specific documents found in the knowledge base for this query. Rely on your general expertise in AML/compliance topics, but be clear that this is general guidance.`}

RESPONSE STRUCTURE:
1. **Start Naturally**: Begin with a brief acknowledgment (e.g., "Great question!" / "Ottima domanda!")
2. **Direct Answer**: Provide a clear, concise answer to the main question (2-3 sentences)
3. **Key Details**: Break down into 3-5 specific, actionable bullet points with concrete details
4. **Practical Example**: Include a real-world example when helpful
5. **Sources**: ${hasContext ? 'Cite specific sources with dates' : 'Clarify this is general guidance'}
6. **Next Steps**: Offer practical advice or suggest related questions

FORMATTING:
- Use bullet points (•) for clarity
- Bold key terms, regulation names, and important numbers
- Include specific dates, thresholds, and numbers when relevant
- Use clear spacing between sections
- For Italian: use proper Italian formatting and terminology

TONE GUIDELINES:
- Professional but NOT stiff or cold
- Helpful and educational, not lecturing
- Acknowledge the user's question positively
- Use phrases like:
  - IT: "Ottima domanda", "Certamente", "Ti spiego", "In pratica"
  - EN: "Great question", "Absolutely", "Let me explain", "In practice"
- Avoid robotic phrases like "I appreciate your question but..." when the question IS on-topic

COMPLIANCE DISCLAIMER (when appropriate):
${isItalian 
  ? "⚠️ Questo è un orientamento generale. Per decisioni specifiche, consulta sempre professionisti legali/compliance qualificati e verifica la versione corrente delle normative applicabili."
  : "⚠️ This is general guidance. For specific compliance decisions, always consult qualified legal/compliance professionals and verify the current version of applicable regulations."}`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.7, // Increased for more natural conversation
      max_tokens: 2048, // Doubled for comprehensive answers
      top_p: 0.9,
    });

    const response = completion.choices[0]?.message?.content || 
      (isItalian 
        ? 'Mi dispiace, non sono riuscito a generare una risposta. Riprova per favore.'
        : 'Sorry, I could not generate a response. Please try again.');

    responseCache.set(cacheKey, {
      response,
      timestamp: Date.now(),
    });

    // Clean cache if too large
    if (responseCache.size > 100) {
      const entries = Array.from(responseCache.entries());
      const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      responseCache.clear();
      sorted.slice(0, 100).forEach(([key, value]) => {
        responseCache.set(key, value);
      });
    }

    return NextResponse.json({ response, cached: false });

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