import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Comprehensive AML/Compliance knowledge base
const knowledgeBase = [
  // FATF
  {
    title: 'FATF 40 Recommendations Overview',
    content: 'The FATF 40 Recommendations are the international standards for combating money laundering and terrorist financing. Key recommendations include: Customer Due Diligence (Rec. 10), Record Keeping (Rec. 11), Suspicious Transaction Reporting (Rec. 20), and beneficial ownership transparency (Rec. 24-25). Countries are assessed for compliance through mutual evaluations.',
    source: 'FATF',
    category: 'AML',
    date: '2012-02-16',
  },
  {
    title: 'FATF Travel Rule (Recommendation 16)',
    content: 'The Travel Rule requires VASPs and financial institutions to share originator and beneficiary information for wire transfers and virtual asset transfers exceeding 1,000 USD/EUR. Information must include: name, account number, address, and national ID. Applies to both traditional and virtual asset transfers.',
    source: 'FATF',
    category: 'CRYPTO',
    date: '2019-06-21',
  },
  {
    title: 'FATF Virtual Assets Guidance',
    content: 'Virtual Asset Service Providers (VASPs) must comply with same AML/CFT standards as traditional financial institutions. Requirements include: licensing/registration, CDD for customers, transaction monitoring, SAR filing, and Travel Rule compliance. Countries must supervise VASPs and apply preventive measures.',
    source: 'FATF',
    category: 'CRYPTO',
    date: '2021-10-28',
  },
  {
    title: 'FATF Risk-Based Approach',
    content: 'Financial institutions must adopt a risk-based approach to AML/CFT compliance. This includes: identifying and assessing ML/TF risks, designing controls proportionate to risks, monitoring and testing effectiveness, and maintaining documentation. Higher-risk customers require Enhanced Due Diligence (EDD).',
    source: 'FATF',
    category: 'AML',
    date: '2012-02-16',
  },

  // EU Directives
  {
    title: '5th Anti-Money Laundering Directive (5AMLD)',
    content: '5AMLD expanded EU AML framework to include: virtual currency platforms and custodian wallet providers, prepaid card limits reduced to €150, enhanced PEP provisions, central beneficial ownership registers, and third-country high-risk jurisdictions list. Enhanced due diligence required for transactions with high-risk countries.',
    source: 'EU',
    category: 'AML',
    date: '2018-07-09',
  },
  {
    title: '6th Anti-Money Laundering Directive (6AMLD)',
    content: '6AMLD harmonized definition of money laundering across EU with 22 predicate offences including: tax crimes, cybercrime, and environmental crime. Introduced criminal liability for legal persons with penalties up to €5 million or 10% of annual turnover. Extended liability to aiding, abetting, and attempting ML. Established universal jurisdiction for cross-border ML offences.',
    source: 'EU',
    category: 'AML',
    date: '2020-12-03',
  },
  {
    title: 'Markets in Crypto-Assets Regulation (MiCA)',
    content: 'MiCA establishes comprehensive regulatory framework for crypto-assets in EU. CASPs (Crypto-Asset Service Providers) must: obtain authorization, implement AML/CFT controls, ensure consumer protection, maintain capital requirements, and provide transaction transparency. Stablecoins (ARTs and EMTs) subject to additional requirements.',
    source: 'EU',
    category: 'CRYPTO',
    date: '2023-06-09',
  },
  {
    title: 'Transfer of Funds Regulation (TFR)',
    content: 'EU TFR implements FATF Travel Rule requiring crypto providers to collect and share sender/recipient information for all transfers (no de minimis threshold). Applies to CASPs operating in EU. Information must include: name, account number/wallet address, and address. Self-hosted wallet transactions above €1,000 require additional verification.',
    source: 'EU',
    category: 'CRYPTO',
    date: '2023-06-09',
  },

  // KYC/CDD
  {
    title: 'Customer Due Diligence (CDD) Requirements',
    content: 'Standard CDD includes: (1) Identifying customer with valid government-issued ID, (2) Verifying identity through independent sources, (3) Understanding nature and purpose of business relationship, (4) Obtaining beneficial ownership information (≥25% threshold), (5) Conducting ongoing monitoring. CDD must be performed before establishing business relationship.',
    source: 'FATF',
    category: 'KYC',
    date: '2012-02-16',
  },
  {
    title: 'Enhanced Due Diligence (EDD)',
    content: 'EDD required for higher-risk customers including: PEPs, correspondent banking, cross-border relationships, complex ownership structures, and high-risk jurisdictions. Additional measures include: senior management approval, source of wealth/funds investigation, enhanced ongoing monitoring (more frequent reviews), and additional identity verification.',
    source: 'FATF',
    category: 'KYC',
    date: '2012-02-16',
  },
  {
    title: 'Politically Exposed Persons (PEPs)',
    content: 'PEPs are individuals with prominent public functions: heads of state, senior politicians, senior government officials, judicial/military officers, state enterprise executives, and important political party officials. Family members and close associates also considered PEPs. Require EDD, senior approval, and source of wealth determination.',
    source: 'FATF',
    category: 'KYC',
    date: '2012-02-16',
  },
  {
    title: 'Beneficial Ownership Identification',
    content: 'Beneficial owner is natural person who ultimately owns or controls customer (≥25% ownership/voting rights threshold). Required for: legal persons, trusts, and other legal arrangements. Must verify identity of beneficial owners and understand ownership/control structure. Information must be accurate and up-to-date.',
    source: 'FATF',
    category: 'KYC',
    date: '2012-02-16',
  },
  {
    title: 'Simplified Due Diligence (SDD)',
    content: 'SDD may apply to lower-risk customers where ML/TF risk is demonstrably low: financial institutions in FATF-compliant countries, listed companies subject to disclosure requirements, government entities, and low-value products with usage restrictions. Reduced measures require risk assessment justification and regulatory approval.',
    source: 'FATF',
    category: 'KYC',
    date: '2012-02-16',
  },

  // Transaction Monitoring
  {
    title: 'Suspicious Activity Reporting (SAR)',
    content: 'Financial institutions must file SAR when transaction reasonably suspected to involve proceeds of crime or terrorism financing. Key elements: transaction details, parties involved, reason for suspicion, and supporting documentation. Filing timelines vary by jurisdiction (typically 30 days). Tipping off customer is prohibited.',
    source: 'FATF',
    category: 'AML',
    date: '2012-02-16',
  },
  {
    title: 'Transaction Monitoring Red Flags',
    content: 'Common ML red flags include: unusual transaction patterns, transactions inconsistent with customer profile, rapid movement of funds, use of intermediaries without clear business purpose, transactions with high-risk jurisdictions, structured transactions below reporting thresholds, and reluctance to provide information. Triggers should prompt enhanced scrutiny.',
    source: 'FATF',
    category: 'AML',
    date: '2012-02-16',
  },
  {
    title: 'Threshold Reporting Requirements',
    content: 'Most jurisdictions require reporting of currency transactions above threshold (typically $10,000 USD equivalent). Reports include: Currency Transaction Reports (CTRs), cross-border currency declarations, and wire transfer reports. Structuring transactions to evade reporting (smurfing) is a criminal offense.',
    source: 'FATF',
    category: 'AML',
    date: '2012-02-16',
  },

  // Sanctions
  {
    title: 'Sanctions Screening Requirements',
    content: 'Financial institutions must screen customers, transactions, and payments against: UN Security Council sanctions lists, national sanctions (OFAC, EU, etc.), and PEP databases. Screening required at: onboarding, periodically (at least annually), and real-time for transactions. Matches require investigation and potential blocking/freezing.',
    source: 'OFAC',
    category: 'SANCTIONS',
    date: '2024-01-01',
  },
  {
    title: 'OFAC SDN List Compliance',
    content: 'Office of Foreign Assets Control (OFAC) Specially Designated Nationals (SDN) list contains individuals and entities whose assets must be blocked. US persons prohibited from dealing with SDNs. Screening must check: name, address, date of birth, passport number, and alternate spellings. 50% Rule: entities owned 50%+ by SDN also blocked.',
    source: 'OFAC',
    category: 'SANCTIONS',
    date: '2024-01-01',
  },

  // Italian Regulations
  {
    title: 'D.Lgs 231/2007 - Italian AML Law',
    content: 'Italian AML framework implementing EU directives. Requires: customer identification with valid ID, beneficial ownership identification (≥25%), adequate verification, risk profiling, and ongoing monitoring. Specific provisions for high-risk customers, PEPs, and cross-border relationships. UIF (Financial Intelligence Unit) receives SARs.',
    source: 'Banca Italia',
    category: 'AML',
    date: '2007-11-21',
  },
  {
    title: 'Banca d\'Italia AML Provisions',
    content: 'Italian banks must implement: (1) Internal controls and compliance function, (2) Risk-based approach with risk assessment, (3) Adequate personnel training, (4) Independent audit function, (5) Data retention for 10 years, (6) Reporting to UIF within 30 days of suspicion detection. Penalties for non-compliance up to €5 million.',
    source: 'Banca Italia',
    category: 'AML',
    date: '2024-01-01',
  },

  // Crypto-Specific
  {
    title: 'VASP Licensing Requirements',
    content: 'Virtual Asset Service Providers must obtain license/registration in operating jurisdictions. Requirements typically include: minimum capital, fit-and-proper test for executives, AML/CFT compliance program, cybersecurity measures, and customer fund protection. Examples: MiCA authorization (EU), BitLicense (NY), FCA registration (UK).',
    source: 'FATF',
    category: 'CRYPTO',
    date: '2019-06-21',
  },
  {
    title: 'Crypto Transaction Monitoring',
    content: 'VASPs must monitor for: unusual withdrawal patterns, mixing services usage, transactions to/from darknet markets, high-risk jurisdictions, rapid conversion and withdrawal, and large transactions from unverified sources. Blockchain analytics tools help identify suspicious wallet addresses and transaction patterns.',
    source: 'FATF',
    category: 'CRYPTO',
    date: '2021-10-28',
  },
  {
    title: 'DeFi and AML Challenges',
    content: 'Decentralized Finance (DeFi) presents AML challenges due to: no central intermediary, pseudonymous transactions, and cross-border nature. FATF guidance suggests protocol developers, front-end interface providers, and certain DeFi actors may be VASPs subject to regulation. Risk-based approach required given evolving technology.',
    source: 'FATF',
    category: 'CRYPTO',
    date: '2021-10-28',
  },

  // Risk Assessment
  {
    title: 'National Risk Assessment (NRA)',
    content: 'Countries must conduct National Risk Assessments to identify, assess, and understand ML/TF risks. NRA process includes: identifying threats (criminal proceeds, terrorist financing), vulnerabilities (gaps in controls), and consequences (impact on financial system). Results inform national AML/CFT strategy and resource allocation.',
    source: 'FATF',
    category: 'AML',
    date: '2012-02-16',
  },
  {
    title: 'Customer Risk Rating',
    content: 'Risk rating assigns risk level (low/medium/high) based on factors: customer type (individual/legal entity/PEP), geographic risk (jurisdiction), product/service risk (cash-intensive, anonymous), and delivery channel risk (non-face-to-face). Higher risk = enhanced measures. Risk ratings must be documented and regularly reviewed.',
    source: 'FATF',
    category: 'KYC',
    date: '2012-02-16',
  },
];

async function populateDatabase() {
  console.log('🐼 Starting ComplyPanda database population...\n');

  // Check connection
  const { error: connectionError } = await supabase
    .from('aml_knowledge')
    .select('count')
    .limit(1);

  if (connectionError) {
    console.error('❌ Database connection failed:', connectionError.message);
    console.log('\n💡 Make sure your .env.local has:');
    console.log('   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co');
    console.log('   SUPABASE_SERVICE_KEY=eyJxxx...\n');
    process.exit(1);
  }

  console.log('✅ Database connection successful\n');

  // Clear existing data (optional - comment out if you want to keep existing)
  console.log('🗑️  Clearing existing data...');
  await supabase.from('aml_knowledge').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  console.log('✅ Cleared\n');

  // Insert data in batches
  console.log(`📥 Inserting ${knowledgeBase.length} compliance documents...\n`);
  
  let inserted = 0;
  let failed = 0;

  for (const item of knowledgeBase) {
    const { error } = await supabase
      .from('aml_knowledge')
      .insert(item);

    if (error) {
      console.error(`❌ Failed to insert: ${item.title}`);
      console.error(`   Error: ${error.message}\n`);
      failed++;
    } else {
      inserted++;
      console.log(`✅ [${inserted}/${knowledgeBase.length}] ${item.title}`);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Inserted: ${inserted}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📚 Total: ${knowledgeBase.length}\n`);

  // Verify
  const { data, error } = await supabase
    .from('aml_knowledge')
    .select('source, count');

  if (!error && data) {
    console.log('📈 Database breakdown by source:');
    const counts: Record<string, number> = {};
    // Note: This is a simplified count, adjust based on actual response structure
    console.log('   (Run SELECT source, COUNT(*) FROM aml_knowledge GROUP BY source; in Supabase SQL editor for accurate counts)\n');
  }

  console.log('🎉 Database population complete!');
  console.log('🐼 ComplyPanda is ready to answer compliance questions!\n');
}

populateDatabase().catch(console.error);