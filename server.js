const http = require("http");
const fs = require("fs");
const path = require("path");

loadEnv();

const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      await handleAnalyze(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong on the server." });
  }
});

if (require.main === module) {
  server.listen(port, () => {
    console.log(`Ali Nikovic portfolio running at http://localhost:${port}`);
  });
}

async function handleAnalyze(req, res) {
  const body = await readBody(req);
  const input = String(body.query || "").trim();
  const result = await analyzeQueryInput(input);
  sendJson(res, result.status, result.payload);
}

async function analyzeQueryInput(input) {
  if (!input) {
    return {
      status: 400,
      payload: { error: "Enter a company name or ticker." }
    };
  }

  if (input.length > 80) {
    return {
      status: 400,
      payload: { error: "Keep the search under 80 characters." }
    };
  }

  const marketBrief = await createMarketResearchBrief(input);
  if (marketBrief) {
    return { status: 200, payload: marketBrief };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      status: 200,
      payload: {
        text: createOfflineResearchBrief(input),
        citations: []
      }
    };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 4,
          user_location: {
            type: "approximate",
            country: "US",
            timezone: "America/New_York"
          }
        }
      ],
      system:
        "You are a careful finance research assistant for a student portfolio website. " +
        "Use current web search when helpful. Be concise, balanced, and source-aware. " +
        "Do not give buy, sell, or hold instructions. Always remind the user that this is educational research, not financial advice.",
      messages: [
        {
          role: "user",
          content:
            `Analyze ${input}. Include: 1) what the company does, 2) recent news or developments, ` +
            "3) possible positive catalysts, 4) possible risks or negative catalysts, " +
            "5) key metrics or questions to research next. Use plain language."
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    return {
      status: response.status,
      payload: {
        error: data.error?.message || "The AI request failed."
      }
    };
  }

  const parsed = parseAnthropicContent(data.content || []);
  return { status: 200, payload: parsed };
}

async function createMarketResearchBrief(input) {
  try {
    const resolved = await resolveStock(input);
    if (!resolved) {
      return null;
    }

    const [quote, newsItems] = await Promise.all([
      fetchQuote(resolved.symbol),
      fetchStockNews(resolved.symbol)
    ]);

    if (!quote || !quote.price) {
      return null;
    }

    const name = quote.name || resolved.name || resolved.symbol;
    const companyProfile = getCompanyProfile(resolved.symbol, name);
    const change = quote.price - quote.previousClose;
    const changePercent = quote.previousClose ? (change / quote.previousClose) * 100 : 0;
    const direction = change >= 0 ? "up" : "down";
    const updatedAt = quote.marketTime
      ? new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "America/New_York"
        }).format(new Date(quote.marketTime * 1000))
      : "latest available market data";

    const newsText = newsItems.length
      ? newsItems.map(item => {
          const date = item.time
            ? new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                timeZone: "America/New_York"
              }).format(new Date(item.time * 1000))
            : "recent";
          return `- ${item.title} (${item.publisher || "Market news"}, ${date})`;
        }).join("\n")
      : "- No recent headlines were returned by the market data source. Check investor relations and major financial news before making conclusions.";

    return {
      text: [
        `Stock Research Brief: ${name} (${resolved.symbol})`,
        "",
        "Price Snapshot",
        `- Current price: ${formatCurrency(quote.price, quote.currency)}`,
        `- Today's move: ${formatSignedCurrency(change, quote.currency)} (${formatSignedPercent(changePercent)})`,
        `- The stock is ${direction} for the current trading day compared with the previous close.`,
        `- Exchange: ${quote.exchange || "Not specified"}`,
        `- Last updated: ${updatedAt}`,
        "",
        "What The Company Does",
        `- ${companyProfile}`,
        "",
        "Recent News",
        newsText,
        "",
        "Educational research only. This is not financial advice or a buy, sell, or hold recommendation."
      ].join("\n"),
      citations: [
        {
          title: "Yahoo Finance quote data",
          url: `https://finance.yahoo.com/quote/${encodeURIComponent(resolved.symbol)}`
        },
        ...newsItems
          .filter(item => item.url)
          .slice(0, 3)
          .map(item => ({
            title: item.title,
            url: item.url
          }))
      ]
    };
  } catch (error) {
    console.error("Market research lookup failed:", error.message);
    return null;
  }
}

async function resolveStock(input) {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9. -]/g, "");
  const aliases = {
    nvida: "NVDA",
    nvidia: "NVDA",
    tesla: "TSLA",
    apple: "AAPL",
    microsoft: "MSFT",
    amazon: "AMZN",
    meta: "META",
    facebook: "META",
    google: "GOOGL",
    alphabet: "GOOGL",
    jpmorgan: "JPM",
    "jp morgan": "JPM",
    "jp morgan chase": "JPM",
    netflix: "NFLX"
  };

  if (aliases[normalized]) {
    return { symbol: aliases[normalized], name: input };
  }

  if (/^[a-z.]{1,6}$/i.test(input.trim())) {
    return { symbol: input.trim().toUpperCase(), name: input.trim().toUpperCase() };
  }

  const search = await fetchJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(input)}&quotesCount=5&newsCount=0`
  );
  const match = (search.quotes || []).find(item =>
    item.symbol && ["EQUITY", "ETF"].includes(item.quoteType)
  );

  if (!match) {
    return null;
  }

  return {
    symbol: match.symbol,
    name: match.shortname || match.longname || match.symbol
  };
}

async function fetchQuote(symbol) {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`
  );
  const result = data.chart?.result?.[0];
  const meta = result?.meta;

  if (!meta) {
    return null;
  }

  return {
    name: meta.longName || meta.shortName,
    price: Number(meta.regularMarketPrice || meta.previousClose || meta.chartPreviousClose),
    previousClose: Number(meta.previousClose || meta.chartPreviousClose),
    currency: meta.currency || "USD",
    exchange: meta.exchangeName || meta.fullExchangeName,
    marketTime: meta.regularMarketTime
  };
}

async function fetchStockNews(symbol) {
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=4`
  );

  return (data.news || []).slice(0, 3).map(item => ({
    title: item.title,
    publisher: item.publisher,
    time: item.providerPublishTime,
    url: item.link
  })).filter(item => item.title);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json",
        "user-agent": "Mozilla/5.0 Stock Research Preview"
      }
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function getCompanyProfile(symbol, name) {
  const profiles = {
    NVDA: "NVIDIA designs graphics processing units, accelerated computing platforms, data-center chips, AI hardware and software tools used in gaming, cloud computing, artificial intelligence, professional visualization, and autonomous systems.",
    TSLA: "Tesla designs and sells electric vehicles, energy storage products, solar technology, charging services, and related software-enabled automotive features.",
    AAPL: "Apple designs and sells consumer technology products and services, including iPhone, Mac, iPad, wearables, digital content, payments, cloud services, and subscriptions.",
    MSFT: "Microsoft sells cloud computing, productivity software, operating systems, gaming products, enterprise tools, LinkedIn services, and AI-enabled business platforms.",
    AMZN: "Amazon operates e-commerce marketplaces, cloud infrastructure through AWS, advertising services, subscriptions, logistics, streaming, and consumer devices.",
    META: "Meta operates social media, messaging, advertising, virtual reality, and AI products across platforms including Facebook, Instagram, WhatsApp, Threads, and Reality Labs.",
    GOOGL: "Alphabet operates Google Search, YouTube, digital advertising, Android, cloud computing, consumer apps, AI research, and other technology businesses.",
    JPM: "JPMorgan Chase provides banking, credit cards, investment banking, asset management, trading, lending, and other financial services.",
    NFLX: "Netflix operates a subscription streaming entertainment platform and invests in original films, series, games, and global content distribution."
  };

  return profiles[symbol] || `${name} is a publicly traded company. Review its investor relations materials to understand its products, customers, revenue sources, and business segments.`;
}

function formatCurrency(value, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function formatSignedCurrency(value, currency) {
  const formatted = formatCurrency(Math.abs(value), currency);
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function formatSignedPercent(value) {
  const formatted = `${Math.abs(value).toFixed(2)}%`;
  return `${value >= 0 ? "+" : "-"}${formatted}`;
}

function createOfflineResearchBrief(input) {
  return [
    `Research Brief: ${input}`,
    "",
    "This preview is ready for portfolio testing. Live web search is not connected yet, so treat this as a structured research framework rather than current market analysis.",
    "",
    "Company Snapshot",
    `- Identify what ${input} sells, who its main customers are, and how the company earns revenue.`,
    "- Review the latest annual report, investor presentation, and most recent quarterly earnings release.",
    "",
    "Positive Catalysts To Research",
    "- Revenue growth, improving margins, new products, market expansion, or stronger demand trends.",
    "- Management guidance that suggests improving fundamentals or better operating efficiency.",
    "",
    "Risks To Research",
    "- Valuation concerns, competition, slowing demand, debt levels, regulation, or execution risk.",
    "- Any recent news that could pressure earnings, cash flow, or investor sentiment.",
    "",
    "Key Questions",
    "- What is driving recent stock movement?",
    "- Are earnings, revenue, and free cash flow improving or weakening?",
    "- How does the company compare with its closest competitors?",
    "- What assumptions would need to be true for the stock to perform well?",
    "",
    "Educational research only. This is not financial advice or a buy, sell, or hold recommendation."
  ].join("\n");
}

function parseAnthropicContent(content) {
  const textParts = [];
  const citationMap = new Map();

  for (const block of content) {
    if (block.type === "text" && block.text) {
      textParts.push(block.text);

      for (const citation of block.citations || []) {
        if (citation.url && !citationMap.has(citation.url)) {
          citationMap.set(citation.url, {
            title: citation.title || citation.url,
            url: citation.url
          });
        }
      }
    }
  }

  return {
    text: textParts.join("\n\n").trim() || "No analysis was returned.",
    citations: Array.from(citationMap.values())
  };
}

function serveStatic(pathname, res) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const requestedPath = path.normalize(decodeURIComponent(normalized)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, requestedPath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(publicDir, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) {
          sendJson(res, 404, { error: "Not found" });
          return;
        }
        res.writeHead(200, { "content-type": mimeTypes[".html"] });
        res.end(fallback);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 10000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });

    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function loadEnv() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");

    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

module.exports = {
  analyzeQueryInput
};
