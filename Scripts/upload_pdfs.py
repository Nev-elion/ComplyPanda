#!/usr/bin/env python3
"""
Upload PDF files to ComplyPanda database
Processa tutti i PDF da una cartella e li inserisce in Supabase
"""

import os
import sys
from pathlib import Path
import PyPDF2
from supabase import create_client
from dotenv import load_dotenv
import re
from datetime import datetime

# Carica environment variables
load_dotenv('.env.local')

# Supabase client
supabase = create_client(
    os.getenv('NEXT_PUBLIC_SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_KEY')
)

def extract_text_from_pdf(pdf_path):
    """Estrae testo da un PDF"""
    try:
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            text = ''
            
            # Estrai testo da tutte le pagine
            for page_num, page in enumerate(reader.pages):
                try:
                    page_text = page.extract_text()
                    text += page_text + '\n'
                except Exception as e:
                    print(f"      ⚠️  Error on page {page_num + 1}: {e}")
                    continue
            
            return text.strip()
            
    except Exception as e:
        print(f"    ❌ Error reading PDF: {e}")
        return ''

def chunk_text(text, max_length=2000):
    """Divide il testo in chunks"""
    # Pulisci il testo
    text = re.sub(r'\s+', ' ', text).strip()
    
    if len(text) < 300:
        return []
    
    chunks = []
    current = ''
    
    # Split per paragrafi
    paragraphs = text.split('\n\n')
    
    for paragraph in paragraphs:
        para = paragraph.strip()
        if not para:
            continue
            
        # Se aggiungere questo paragrafo supera il limite
        if len(current) + len(para) > max_length and current:
            chunks.append(current.strip())
            current = para
        else:
            current += ('\n\n' if current else '') + para
    
    # Aggiungi ultimo chunk
    if current:
        chunks.append(current.strip())
    
    # Filtra chunk troppo corti
    return [c for c in chunks if len(c) > 200]

def detect_source_and_category(filename, folder_name):
    """Rileva automaticamente fonte e categoria"""
    filename_lower = filename.lower()
    folder_lower = folder_name.lower()
    
    # UIF
    if 'uif' in folder_lower or any(word in filename_lower for word in ['quaderno', 'rapporto uif', 'comunicazione uif']):
        return 'UIF', 'AML'
    
    # FATF
    if 'fatf' in folder_lower or 'gafi' in folder_lower or any(word in filename_lower for word in ['fatf', 'recommendation']):
        return 'FATF', 'AML'
    
    # Banca d'Italia
    if 'bancaitalia' in folder_lower or 'banca' in folder_lower or any(word in filename_lower for word in ['circolare', 'provvedimento', 'disposizioni']):
        return 'Banca Italia', 'KYC'
    
    # EBA
    if 'eba' in folder_lower or 'eba' in filename_lower:
        return 'EBA', 'AML'
    
    # EU
    if any(word in filename_lower for word in ['direttiva', 'regolamento', 'directive', 'regulation']):
        return 'EU Commission', 'AML'
    
    # Default
    return 'Other', 'AML'

def check_if_exists(title):
    """Controlla se documento già esiste nel database"""
    try:
        result = supabase.table('aml_knowledge')\
            .select('id')\
            .ilike('title', f'%{title[:50]}%')\
            .limit(1)\
            .execute()
        
        return len(result.data) > 0
    except:
        return False

def process_pdf(pdf_path, skip_existing=True):
    """Processa un singolo PDF"""
    filename = pdf_path.name
    folder_name = pdf_path.parent.name
    
    print(f"\n  📄 {filename}")
    
    # Check se già esiste
    if skip_existing and check_if_exists(filename.replace('.pdf', '')):
        print(f"    ⏭️  Già nel database, skip")
        return 0, 0
    
    # Estrai testo
    print(f"    🔍 Extracting text...")
    text = extract_text_from_pdf(pdf_path)
    
    if len(text) < 500:
        print(f"    ⚠️  Too short ({len(text)} chars), skipping")
        return 0, 1
    
    print(f"    ✅ Extracted {len(text):,} characters")
    
    # Chunk
    chunks = chunk_text(text)
    
    if not chunks:
        print(f"    ⚠️  No valid chunks created")
        return 0, 1
    
    print(f"    ✂️  Created {len(chunks)} chunks")
    
    # Detect source/category
    source, category = detect_source_and_category(filename, folder_name)
    print(f"    🏷️  Source: {source} | Category: {category}")
    
    # Insert chunks
    inserted = 0
    for i, chunk in enumerate(chunks):
        title = f"{filename.replace('.pdf', '')} - Part {i + 1}/{len(chunks)}" if len(chunks) > 1 else filename.replace('.pdf', '')
        
        try:
            supabase.table('aml_knowledge').insert({
                'title': title,
                'content': chunk,
                'source': source,
                'category': category,
                'date': datetime.now().strftime('%Y-%m-%d'),
            }).execute()
            
            inserted += 1
            
        except Exception as e:
            print(f"    ❌ DB error on chunk {i + 1}: {e}")
    
    print(f"    ✅ Inserted {inserted}/{len(chunks)} chunks")
    
    return inserted, 0

def process_folder(folder_path, skip_existing=True):
    """Processa tutti i PDF in una cartella"""
    folder = Path(folder_path)
    
    if not folder.exists():
        print(f"❌ Folder non esiste: {folder_path}")
        return
    
    # Trova tutti i PDF (anche nelle sottocartelle)
    pdf_files = list(folder.rglob('*.pdf')) + list(folder.rglob('*.PDF'))
    
    if not pdf_files:
        print(f"❌ Nessun PDF trovato in: {folder_path}")
        return
    
    print(f"\n{'=' * 80}")
    print(f"📚 Trovati {len(pdf_files)} PDF files")
    print(f"📂 Cartella: {folder_path}")
    print('=' * 80)
    
    total_inserted = 0
    total_failed = 0
    total_skipped = 0
    
    for i, pdf_path in enumerate(pdf_files):
        print(f"\n[{i + 1}/{len(pdf_files)}] {pdf_path.relative_to(folder)}")
        
        inserted, failed = process_pdf(pdf_path, skip_existing)
        
        if inserted == 0 and failed == 0:
            total_skipped += 1
        else:
            total_inserted += inserted
            total_failed += failed
    
    # Summary
    print('\n' + '=' * 80)
    print('📊 SUMMARY')
    print('=' * 80)
    print(f"✅ Total chunks inserted: {total_inserted}")
    print(f"⏭️  Files skipped (already in DB): {total_skipped}")
    print(f"❌ Failed: {total_failed}")
    print('=' * 80)

def main():
    print('\n🐼 ComplyPanda PDF Uploader')
    print('=' * 80)
    
    # Determina cartella da processare
    if len(sys.argv) > 1:
        folder_path = sys.argv[1]
    else:
        folder_path = './documents'
    
    # Check flag skip existing
    skip_existing = '--force' not in sys.argv
    
    if not skip_existing:
        print('⚠️  Force mode: will re-upload even existing documents')
    
    process_folder(folder_path, skip_existing)
    
    print('\n🐼 Upload complete!\n')

if __name__ == '__main__':
    main()