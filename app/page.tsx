'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Moon, Sun, Github, FileDown, X, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ComplyPanda() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hello! 🐼 I\'m Panda, your friendly compliance companion. In a world of grey, I help you navigate AML, CFT, and regulatory compliance. Ask me anything!',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState('');
  const [zenMode, setZenMode] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [showSecretMessage, setShowSecretMessage] = useState(false);
  const [pandaEating, setPandaEating] = useState(false);
  const [konamiSequence, setKonamiSequence] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const zenAudioRefs = useRef({
    chime: null as HTMLAudioElement | null,
    water: null as HTMLAudioElement | null,
    wind: null as HTMLAudioElement | null,
  });

  useEffect(() => {
    const hour = new Date().getHours();
    setDarkMode(hour >= 20 || hour < 6);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsTransitioning(true);
      setTimeout(() => setShowIntro(false), 800);
    }, 2800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !showIntro) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let animationId: number;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      
      ctx.fillStyle = darkMode ? '#000' : '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const gridSize = 40;
      const lineLength = 15;
      const gap = 10;
      
      ctx.strokeStyle = darkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.15)';
      ctx.lineWidth = 1;
      ctx.setLineDash([lineLength, gap]);

      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const maxRadius = Math.min(canvas.width, canvas.height) / 2;
      const numCircles = 5;
      
      for (let i = 0; i < numCircles; i++) {
        const radius = (elapsed / 10 + i * 50) % maxRadius;
        const opacity = 1 - (radius / maxRadius);
        
        ctx.save();
        ctx.strokeStyle = darkMode 
          ? `rgba(255, 255, 255, ${opacity * 0.4})` 
          : `rgba(0, 0, 0, ${opacity * 0.4})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([15, 15]);
        ctx.lineDashOffset = -elapsed / 5;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      
      let textOpacity = 1;
      if (elapsed < 300) {
        textOpacity = elapsed / 300;
      } else if (elapsed > 2000) {
        textOpacity = Math.max(0, 1 - (elapsed - 2000) / 800);
      }
      
      ctx.font = '60px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = textOpacity;
      ctx.fillText('🐼', centerX, centerY - 60);
      
      ctx.font = 'bold 70px Inter, system-ui, sans-serif';
      ctx.fillStyle = darkMode ? '#FFFFFF' : '#000000';
      ctx.fillText('ComplyPanda', centerX, centerY + 20);
      
      ctx.font = 'italic 18px Inter, system-ui, sans-serif';
      ctx.fillStyle = darkMode 
        ? `rgba(156, 163, 175, ${textOpacity * 0.8})`
        : `rgba(75, 85, 99, ${textOpacity * 0.8})`;
      ctx.fillText('Your black & white friend in a world of grey', centerX, centerY + 60);
      
      ctx.restore();

      if (elapsed < 2800) {
        animationId = requestAnimationFrame(animate);
      }
    };

    animate();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [showIntro, darkMode]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    
    const handleKeyDown = (e: KeyboardEvent) => {
      const newSequence = [...konamiSequence, e.key];
      const last10 = newSequence.slice(-10);
      
      setKonamiSequence(last10);
      
      if (JSON.stringify(last10) === JSON.stringify(konamiCode)) {
        setZenMode(true);
        playZenSound('wind');
        setTimeout(() => {
          setZenMode(false);
        }, 10000);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [konamiSequence]);

  useEffect(() => {
    const resetTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      setPandaEating(false);
      
      idleTimerRef.current = setTimeout(() => {
        setPandaEating(true);
        if (audioUnlocked) playZenSound('chime');
      }, 30000);
    };
    
    resetTimer();
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
    };
  }, [audioUnlocked]);

  useEffect(() => {
    try {
      zenAudioRefs.current.chime = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
      zenAudioRefs.current.water = new Audio('https://assets.mixkit.co/active_storage/sfx/2470/2470-preview.mp3');
      zenAudioRefs.current.wind = new Audio('https://assets.mixkit.co/active_storage/sfx/3/3-preview.mp3');
      
      Object.values(zenAudioRefs.current).forEach(audio => {
        if (audio) {
          audio.volume = 0.3;
          audio.preload = 'auto';
          audio.crossOrigin = 'anonymous';
        }
      });
    } catch (error) {
      console.log('Audio setup failed:', error);
    }
  }, []);

  const unlockAudio = () => {
    if (!audioUnlocked) {
      Object.values(zenAudioRefs.current).forEach(audio => {
        if (audio) {
          audio.play().then(() => {
            audio.pause();
            audio.currentTime = 0;
          }).catch(() => {});
        }
      });
      setAudioUnlocked(true);
    }
  };

  const playZenSound = (type: 'chime' | 'water' | 'wind') => {
    const audio = zenAudioRefs.current[type];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch((error) => {
        console.log(`Audio playback failed:`, error);
      });
    }
  };

  const SakuraSVG = ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="2" fill="#ffc0cb" />
      {[0, 72, 144, 216, 288].map((angle, i) => {
        const x = 12 + 8 * Math.cos((angle * Math.PI) / 180);
        const y = 12 + 8 * Math.sin((angle * Math.PI) / 180);
        return (
          <ellipse 
            key={i}
            cx={x} 
            cy={y} 
            rx="4" 
            ry="6" 
            fill="#ffc0cb"
            transform={`rotate(${angle} ${x} ${y})`}
          />
        );
      })}
    </svg>
  );

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const getCachedResponse = (question: string): string | null => {
    try {
      const cache = localStorage.getItem('complypanda_cache');
      if (!cache) return null;
      
      const parsed = JSON.parse(cache);
      const normalized = question.toLowerCase().trim();
      
      const cached = parsed[normalized];
      if (cached && Date.now() - cached.timestamp < 86400000) {
        return cached.response;
      }
      return null;
    } catch {
      return null;
    }
  };

  const setCachedResponse = (question: string, response: string) => {
    try {
      const cache = localStorage.getItem('complypanda_cache');
      const parsed = cache ? JSON.parse(cache) : {};
      
      const normalized = question.toLowerCase().trim();
      parsed[normalized] = {
        response,
        timestamp: Date.now(),
      };
      
      const entries = Object.entries(parsed);
      if (entries.length > 50) {
        const sorted = entries.sort((a: any, b: any) => b[1].timestamp - a[1].timestamp);
        const limited = Object.fromEntries(sorted.slice(0, 50));
        localStorage.setItem('complypanda_cache', JSON.stringify(limited));
      } else {
        localStorage.setItem('complypanda_cache', JSON.stringify(parsed));
      }
    } catch (e) {
      console.error('Cache error:', e);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    const userInput = input;
    setMessages([...messages, userMessage]);
    setInput('');
    setIsLoading(true);

    const cached = getCachedResponse(userInput);
    if (cached) {
      const assistantMessage: Message = {
        role: 'assistant',
        content: cached,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userInput }),
      });

      const data = await response.json();

      if (response.ok) {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.response,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, assistantMessage]);
        
        setCachedResponse(userInput, data.response);
      } else {
        throw new Error(data.error || 'Failed to get response');
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const generateReport = () => {
    const conversationMessages = messages.slice(1);
    
    if (conversationMessages.length === 0) {
      alert('Start a conversation with Panda first! 🐼');
      return;
    }

    const topics = conversationMessages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(', ');

    const title = `AML & Compliance Research: ${topics.slice(0, 60)}${topics.length > 60 ? '...' : ''}`;
    
    const markdown = `# ${title}

*Generated by ComplyPanda 🐼 on ${new Date().toLocaleDateString('en-US', { 
  year: 'numeric', 
  month: 'long', 
  day: 'numeric' 
})}*

---

## Conversation Transcript

${conversationMessages
  .map((msg) => {
    const role = msg.role === 'user' ? '**You**' : '**Panda 🐼**';
    const time = msg.timestamp.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    return `### ${role} (${time})

${msg.content}

`;
  })
  .join('\n---\n\n')}

---

*Generated with ComplyPanda 🐼 - Your black & white friend in a world of grey*
*https://complypanda.com · https://github.com/Nev-elion/ComplyPanda*
`;

    setReportContent(markdown);
    setShowReportModal(true);
  };

  const downloadReport = () => {
    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ComplyPanda-Report-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(reportContent);
    alert('Report copied to clipboard!');
  };

  if (showIntro) {
    return (
      <div suppressHydrationWarning className={`fixed inset-0 ${darkMode ? 'bg-black' : 'bg-white'} flex items-center justify-center overflow-hidden`}>
        <canvas ref={canvasRef} className="absolute inset-0" />
      </div>
    );
  }

  return (
    <div suppressHydrationWarning className={`min-h-screen transition-colors duration-500 ${darkMode ? 'bg-black text-white' : 'bg-white text-black'} animate-main-fade-in relative overflow-hidden`}>
      {zenMode && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute animate-fall"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-10%`,
                animationDelay: `${Math.random() * 5}s`,
                animationDuration: `${8 + Math.random() * 4}s`,
              }}
            >
              <SakuraSVG />
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes mainFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-main-fade-in {
          animation: mainFadeIn 1s ease-in;
        }
        @keyframes fall {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(360deg);
            opacity: 0;
          }
        }
        .animate-fall {
          animation: fall linear forwards;
        }
        @keyframes typing {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 1; }
        }
        .typing-dot {
          animation: typing 1.4s infinite;
        }
        .typing-dot:nth-child(2) {
          animation-delay: 0.2s;
        }
        .typing-dot:nth-child(3) {
          animation-delay: 0.4s;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.5s ease-out;
        }
      `}</style>

      <nav className={`sticky top-0 z-40 border-b ${darkMode ? 'border-gray-800 bg-black/80' : 'border-gray-200 bg-white/80'} backdrop-blur-sm`}>
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div 
                className="text-2xl cursor-pointer hover:scale-110 transition-transform"
                onClick={() => unlockAudio()}
                onDoubleClick={() => {
                  setShowSecretMessage(true);
                  playZenSound('chime');
                }}
                title="Try double-clicking me!"
              >
                🐼
              </div>
              <div>
                <span className="text-xl font-bold tracking-tight">ComplyPanda</span>
                <span className={`ml-3 text-xs px-2 py-1 rounded-full ${darkMode ? 'bg-gray-900 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                  Open Source
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <button
                onClick={() => {
                  unlockAudio();
                  const newZenMode = !zenMode;
                  setZenMode(newZenMode);
                  if (newZenMode) {
                    playZenSound('wind');
                  }
                }}
                className={`flex items-center space-x-1 text-sm font-medium ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-black'} transition-colors hover:scale-110`}
                title={`${zenMode ? 'Disable' : 'Enable'} Zen Mode with sounds!`}
              >
                <span className="text-base">🎋</span>
                {zenMode && <span className="text-xs">Zen</span>}
              </button>
              <a 
                href="https://github.com/Nev-elion/ComplyPanda" 
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center space-x-2 text-sm font-medium ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-black'} transition-colors`}
              >
                <Github className="w-4 h-4" />
                <span>GitHub</span>
              </a>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={`p-2 rounded-lg ${darkMode ? 'hover:bg-gray-900' : 'hover:bg-gray-100'} transition-colors`}
              >
                {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-12 max-w-5xl">
        <div className="min-h-[70vh] mb-8">
          {messages.length === 1 && (
            <div className="text-center mb-16 animate-fade-in">
              <div className="text-8xl mb-6 transition-all duration-500">
                {pandaEating ? '🐼🎋' : '🐼'}
              </div>
              {pandaEating && (
                <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'} mb-4 animate-pulse`}>
                  *nom nom nom* 🎋
                </p>
              )}
              <h1 className="text-7xl font-bold tracking-tight leading-none mb-4">
                ComplyPanda
              </h1>
              <p className={`text-2xl font-light ${darkMode ? 'text-gray-400' : 'text-gray-600'} mb-8 italic`}>
                Your black &amp; white friend in a world of grey
              </p>
              <p className={`text-lg ${darkMode ? 'text-gray-500' : 'text-gray-500'} max-w-2xl mx-auto mb-8`}>
                Navigate AML, Compliance &amp; CFT with zen-like clarity. Free, open-source, and always here to help.
              </p>
              <div className={`inline-flex items-center space-x-6 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <span>🎋 Zen Mode</span>
                <span>·</span>
                <span>⚡ Instant Wisdom</span>
                <span>·</span>
                <span>🌿 Open Source</span>
              </div>
            </div>
          )}

          <div className="space-y-6">
            {messages.slice(1).map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                <div className="max-w-3xl">
                  <div className={`flex items-center space-x-2 mb-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {message.role === 'assistant' && (
                      <>
                        <span className="text-sm">🐼</span>
                        <span className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Panda
                        </span>
                      </>
                    )}
                    {message.role === 'user' && (
                      <span className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        You
                      </span>
                    )}
                  </div>
                  <div className={`px-6 py-4 rounded-2xl ${
                    message.role === 'user'
                      ? darkMode ? 'bg-white text-black' : 'bg-black text-white'
                      : darkMode ? 'bg-gray-900 border border-gray-800' : 'bg-gray-50 border border-gray-200'
                  }`}>
                    <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start animate-fade-in">
                <div className="max-w-3xl">
                  <div className={`flex items-center space-x-2 mb-2`}>
                    <span className="text-sm">🐼</span>
                    <span className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Panda
                    </span>
                  </div>
                  <div className={`inline-block px-6 py-4 rounded-2xl ${darkMode ? 'bg-gray-900 border border-gray-800' : 'bg-gray-50 border border-gray-200'}`}>
                    <div className="flex items-center space-x-2">
                      <span className="text-lg animate-bounce">🎋</span>
                      <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Panda is thinking...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className={`sticky bottom-6 ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'} border rounded-2xl shadow-xl p-2`}>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Ask Panda about AML, compliance, regulations..."
              className={`flex-1 px-4 py-3 bg-transparent border-0 focus:outline-none text-base ${
                darkMode ? 'placeholder-gray-700' : 'placeholder-gray-400'
              }`}
              autoFocus
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={`rounded-xl ${darkMode ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800'}`}
            >
              {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </Button>
            <Button
              onClick={generateReport}
              variant="outline"
              className={`rounded-xl ${darkMode ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-300 hover:bg-gray-100'}`}
              disabled={messages.length <= 1}
            >
              <FileDown className="w-5 h-5" />
            </Button>
          </div>
          <p className={`text-center text-sm mt-6 ${darkMode ? 'text-gray-700' : 'text-gray-400'}`}>
            🐼 Powered by Groq AI · Sources: FATF, EBA, BIS · 
            <a href="https://github.com/Nev-elion/ComplyPanda" className={`ml-1 underline ${darkMode ? 'hover:text-gray-500' : 'hover:text-gray-600'}`}>
              View on GitHub
            </a>
          </p>
        </div>
      </main>

      {showReportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
          <Card className={`w-full max-w-4xl max-h-[80vh] ${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-white'}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  Generated Report
                </CardTitle>
                <button onClick={() => setShowReportModal(false)} className={`${darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'} p-2 rounded-lg transition-colors`}>
                  <X className="w-5 h-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <div className={`${darkMode ? 'bg-black border-gray-800' : 'bg-gray-50 border-gray-200'} border rounded-xl p-6 mb-4 max-h-96 overflow-y-auto`}>
                <pre className="whitespace-pre-wrap text-sm font-mono">{reportContent}</pre>
              </div>
              <div className="flex gap-2">
                <Button onClick={downloadReport} className={`flex-1 ${darkMode ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800'}`}>
                  <FileDown className="w-4 h-4 mr-2" />
                  Download .md
                </Button>
                <Button onClick={copyToClipboard} variant="outline" className={`flex-1 ${darkMode ? 'border-gray-700 hover:bg-gray-800' : ''}`}>
                  Copy to Clipboard
                </Button>
              </div>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'} mt-4 text-center`}>
                💡 Upload this .md file to Google NotebookLM for AI-powered insights and summaries
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {showSecretMessage && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className={`max-w-md p-8 rounded-3xl ${darkMode ? 'bg-gray-900 border-2 border-gray-700' : 'bg-white border-2 border-gray-200'} text-center`}>
            <div className="text-6xl mb-4">🐼✨</div>
            <h3 className="text-2xl font-bold mb-4">Secret Panda Wisdom</h3>
            <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-700'} mb-6 italic`}>
              "In compliance, as in life, the path between black and white is paved with careful consideration and bamboo snacks."
            </p>
            <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'} mb-6`}>
              🎋 Try the Konami Code for Zen Mode! 🎋
              <br />
              <span className="text-xs">↑↑↓↓←→←→BA</span>
            </p>
            <Button
              onClick={() => {
                setShowSecretMessage(false);
                if (audioUnlocked) playZenSound('water');
              }}
              className={`${darkMode ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800'}`}
            >
              Return to Compliance 🐼
            </Button>
          </div>
        </div>
      )}

      <footer className={`relative z-10 border-t ${darkMode ? 'border-gray-800' : 'border-gray-200'} py-8 text-center text-sm mt-20`}>
        <div className="container mx-auto px-6">
          <p className={`mb-3 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            🐼 ComplyPanda · Your black &amp; white friend in a world of grey
          </p>
          <p className={`mb-3 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Open Source · Built with 🎋 for Compliance Professionals
          </p>
          <div className={`flex justify-center space-x-4 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            <a href="#" className={`${darkMode ? 'hover:text-white' : 'hover:text-black'} transition-colors`}>Privacy</a>
            <span>·</span>
            <a href="#" className={`${darkMode ? 'hover:text-white' : 'hover:text-black'} transition-colors`}>Terms</a>
            <span>·</span>
            <a href="#" className={`${darkMode ? 'hover:text-white' : 'hover:text-black'} transition-colors`}>Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}