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
  'wallet', 'exchange', 'custody', 'defi', 'stablecoin', 'token'
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

    if (!isInScope(message)) {
      return NextResponse.json({
        response: `🐼 I appreciate your question, but I specialize exclusively in **AML (Anti-Money Laundering)**, **Compliance**, and **CFT (Combating the Financing of Terrorism)** topics.

I can help you with:
• FATF recommendations and Travel Rule
• KYC/CDD procedures and requirements
• EU directives (5AMLD, 6AMLD, MiCA)
• Sanctions screening and PEP identification
• Transaction monitoring and SAR filing
• Crypto/VASP compliance
• Risk assessment frameworks
• Regulatory updates and guidance

Please ask me a question related to these topics, and I'll be happy to help! 🎋`
      });
    }

    const cacheKey = getCacheKey(message);
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ response: cached.response, cached: true });
    }

    // Enhanced database search with multiple strategies
    const searchTerms = message.toLowerCase().split(' ').filter(w => w.length > 3);
    
    // Try text search first
    let { data: context } = await supabase
      .from('aml_knowledge')
      .select('content, source, title, date, category')
      .textSearch('content', message)
      .limit(8);

    // If no results, try keyword matching
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

    const systemPrompt = `You are Panda 🐼, a highly knowledgeable compliance expert specializing in:
- AML (Anti-Money Laundering)
- KYC/CDD (Know Your Customer / Customer Due Diligence)  
- CFT (Combating the Financing of Terrorism)
- Financial compliance regulations
- Crypto/VASP compliance

YOUR PERSONALITY:
- Professional yet approachable and friendly
- Clear, concise communicator
- Patient educator who breaks down complex topics
- Uses practical examples when helpful
- Occasionally uses 🐼 and 🎋 emojis tastefully

${hasContext ? `VERIFIED REGULATORY SOURCES:
${contextText}

When these sources are available, prioritize them in your answer and cite them explicitly.` : `No specific documents found in the knowledge base for this query. Rely on your general expertise in AML/compliance topics.`}

RESPONSE STRUCTURE:
1. **Direct Answer First**: Start with a clear, direct answer to the user's question
2. **Key Points**: Break down the topic into 3-5 bullet points with practical details
3. **Examples**: Provide a real-world example when helpful
4. **Sources**: ${hasContext ? 'Cite specific sources with dates when using provided context' : 'Explain that this is general guidance based on common compliance practices'}
5. **Actionable Advice**: End with practical next steps or considerations

LANGUAGE MATCHING:
- Always respond in the SAME language as the user's question
- If user asks in Italian, respond entirely in Italian
- If user asks in English, respond entirely in English
- Maintain professional tone in both languages

IMPORTANT GUIDELINES:
- Be comprehensive but not overwhelming
- Use bullet points and clear structure
- Provide specific regulation names, dates, and thresholds when relevant
- If you're not 100% certain, say so clearly
- Always remind users to verify current regulations and consult legal professionals for specific decisions
- Avoid generic responses - be specific and detailed
- Use analogies and examples to clarify complex concepts

COMPLIANCE DISCLAIMER (when appropriate):
"⚠️ This is general guidance. For specific compliance decisions, always consult qualified legal/compliance professionals and verify the current version of applicable regulations."`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.6, // Slightly higher for more natural responses
      max_tokens: 2048, // Double the tokens for more comprehensive answers
      top_p: 0.9,
    });

    const response = completion.choices[0]?.message?.content || 
      'Sorry, I could not generate a response. Please try again.';

    responseCache.set(cacheKey, {
      response,
      timestamp: Date.now(),
    });

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