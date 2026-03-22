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
  '6amld', '5amld', '4amld', 'mld', 'directive', 'policy'
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

    const { data: context } = await supabase
      .from('aml_knowledge')
      .select('content, source, title, date')
      .textSearch('content', message)
      .limit(5);

    const contextText = context?.length 
      ? context.map(item => 
          `[${item.source}${item.date ? ` - ${item.date}` : ''}] ${item.title}:\n${item.content}`
        ).join('\n\n---\n\n')
      : 'No specific regulatory documents found in database. Provide general expertise.';

    const systemPrompt = `You are Panda, an expert AI assistant **exclusively specialized** in:
- AML (Anti-Money Laundering)
- KYC/CDD (Know Your Customer / Customer Due Diligence)
- CFT (Combating the Financing of Terrorism)
- Financial compliance and regulations
- Crypto/VASP compliance

STRICT BOUNDARIES:
- You ONLY answer questions about AML, compliance, CFT, KYC, sanctions, and related financial crime topics
- If a question is outside your scope, politely redirect the user to compliance topics
- You do NOT answer general questions about: weather, recipes, history, science, entertainment, etc.

CONTEXT FROM VERIFIED REGULATORY SOURCES:
${contextText}

RESPONSE GUIDELINES:
1. Always respond in the same language as the user's question
2. Base answers on the provided context when available
3. Cite specific sources (FATF, EBA, Banca d'Italia, etc.) with dates when possible
4. If certain information is missing, clearly state: "I don't have specific regulatory guidance on this in my knowledge base"
5. Maintain professional yet friendly tone (you're Panda 🐼!)
6. Provide practical examples when helpful
7. Structure answers with bullet points for readability
8. Always include relevant regulation dates/versions
9. Use emojis sparingly (🎋 for zen moments, 🐼 for signature)

COMPLIANCE DISCLAIMER:
When appropriate, remind users: "This is general guidance. For specific compliance decisions, consult legal/compliance professionals and verify current regulations."`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.5,
      max_tokens: 1024,
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