const form = document.querySelector("#stock-form");
const input = document.querySelector("#stock-query");
const output = document.querySelector("#analysis-output");
const marketField = document.querySelector("#market-field");

setupMarketField();
setupRevealTransitions();
setupInternalNavigation();

if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

if (form && input && output) {
  form.addEventListener("submit", async event => {
    event.preventDefault();

    const query = input.value.trim();
    if (!query) {
      return;
    }

    setLoading(query);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ query })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed.");
      }

      renderAnalysis(data);
    } catch (error) {
      output.classList.remove("loading");
      output.innerHTML = "";

      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = error.message || "Could not run the analysis.";
      output.append(message);
    }
  });
}

function setupInternalNavigation() {
  const links = document.querySelectorAll('a[href^="#"]');

  links.forEach(link => {
    link.addEventListener("click", event => {
      const targetId = link.getAttribute("href");
      const target = targetId === "#top"
        ? document.querySelector("#top")
        : document.querySelector(targetId);

      if (!target) {
        return;
      }

      event.preventDefault();
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      });
    });
  });
}

function setLoading(query) {
  output.classList.add("loading");
  output.textContent = `Researching ${query}...`;
}

function setupMarketField() {
  if (!marketField) {
    return;
  }

  const context = marketField.getContext("2d");
  const rings = Array.from({ length: 18 }, (_, index) => ({
    index,
    phase: index * 0.72,
    dash: 18 + (index % 5) * 8,
    gap: 9 + (index % 4) * 5
  }));
  let width = 0;
  let height = 0;
  let deviceRatio = 1;
  let scrollProgress = 0;
  let targetProgress = 0;
  let lastDraw = 0;
  const introStartedAt = performance.now();
  const introDelay = 450;
  const introDuration = 1500;

  const resize = () => {
    deviceRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    width = window.innerWidth;
    height = window.innerHeight;
    marketField.width = Math.round(width * deviceRatio);
    marketField.height = Math.round(height * deviceRatio);
    marketField.style.width = `${width}px`;
    marketField.style.height = `${height}px`;
    context.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
  };

  const updateTarget = () => {
    targetProgress = sectionProgress();
  };

  const draw = time => {
    if (time - lastDraw < 33) {
      requestAnimationFrame(draw);
      return;
    }

    lastDraw = time;
    scrollProgress += (targetProgress - scrollProgress) * 0.055;
    context.clearRect(0, 0, width, height);

    const introProgress = Math.max(0, Math.min(1, (time - introStartedAt - introDelay) / introDuration));
    const introReveal = easeOutCubic(introProgress);
    const stageCount = 5;
    const scaled = scrollProgress * (stageCount - 1);
    const segment = Math.min(stageCount - 1, Math.floor(scaled));
    const local = scaled - segment;
    const eased = easeInOutCubic(local);
    const motion = time * 0.00016;

    if (introReveal <= 0) {
      requestAnimationFrame(draw);
      return;
    }

    context.save();
    context.globalAlpha = introReveal;
    context.rect(0, height - height * introReveal, width, height * introReveal);
    context.clip();

    rings.forEach(ring => {
      const current = fieldState(segment, ring.index);
      const next = fieldState(Math.min(stageCount - 1, segment + 1), ring.index);
      const state = mixState(current, next, eased);
      drawSegmentedEllipse(context, state, ring, motion);
    });

    context.restore();

    requestAnimationFrame(draw);
  };

  resize();
  updateTarget();
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", updateTarget, { passive: true });
  requestAnimationFrame(draw);
}

function setupRevealTransitions() {
  const items = document.querySelectorAll(
    ".hero-copy, .intro-section, .section-heading, .focus-grid article, .profile-grid > div, .analyzer-copy, .analyzer, .contact-copy, .contact-card"
  );

  if (!items.length) {
    return;
  }

  items.forEach(item => item.classList.add("reveal"));

  if (!("IntersectionObserver" in window)) {
    items.forEach(item => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
      }
    });
  }, {
    rootMargin: "0px 0px -12% 0px",
    threshold: 0.14
  });

  items.forEach(item => observer.observe(item));
}

function drawSegmentedEllipse(context, state, ring, motion) {
  const alpha = Math.max(0, Math.min(1, state.opacity));
  const cx = window.innerWidth * state.x;
  const cy = window.innerHeight * state.y;
  const rx = Math.max(6, window.innerWidth * state.rx);
  const ry = Math.max(6, window.innerHeight * state.ry);
  const rotation = state.rotate + Math.sin(motion * state.speed + ring.phase) * 0.018;
  const pieces = 46;
  const skipEvery = 7 + ring.index % 5;
  const trim = 0.18 + (ring.index % 4) * 0.035;

  context.save();
  context.translate(cx, cy);
  context.rotate(rotation);
  context.lineWidth = state.width;
  context.strokeStyle = `rgba(5, 5, 5, ${alpha})`;
  context.setLineDash([ring.dash, ring.gap, 2, ring.gap * 0.7]);
  context.lineCap = "round";

  for (let piece = 0; piece < pieces; piece += 1) {
    if (piece % skipEvery === 0) {
      continue;
    }

    const start = (piece / pieces) * Math.PI * 2 + motion * (0.8 + ring.index * 0.012);
    const end = start + (Math.PI * 2 / pieces) * (1 - trim);

    context.beginPath();
    for (let step = 0; step <= 5; step += 1) {
      const angle = start + (end - start) * (step / 5);
      const wobble = 1 + Math.sin(angle * 3 + ring.phase) * state.wobble;
      const x = Math.cos(angle) * rx * wobble;
      const y = Math.sin(angle) * ry * wobble;

      if (step === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  }

  context.restore();

  if (state.spokes) {
    drawSpokes(context, state, ring, motion, cx, cy, rx, ry, rotation, alpha);
  }
}

function drawSpokes(context, state, ring, motion, cx, cy, rx, ry, rotation, alpha) {
  if (ring.index % state.spokes !== 0) {
    return;
  }

  const angle = rotation + ring.phase + motion * 0.7;
  const inner = 0.28 + (ring.index % 4) * 0.08;
  const x1 = cx + Math.cos(angle) * rx * inner;
  const y1 = cy + Math.sin(angle) * ry * inner;
  const x2 = cx + Math.cos(angle + state.spokeSkew) * rx * 1.18;
  const y2 = cy + Math.sin(angle + state.spokeSkew) * ry * 1.18;

  context.save();
  context.lineWidth = Math.max(0.55, state.width * 0.8);
  context.strokeStyle = `rgba(5, 5, 5, ${alpha * 0.7})`;
  context.setLineDash([26, 14, 3, 10]);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  context.restore();
}

function sectionProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;

  if (scrollable <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, window.scrollY / scrollable));
}

function fieldState(stage, index) {
  const t = index / 17;
  const phase = (t - 0.5) * 2;
  const wave = Math.sin(index * 0.74);

  if (stage === 0) {
    return {
      x: 0.74 + wave * 0.018,
      y: 0.43 + phase * 0.12,
      rx: 0.19 - Math.abs(phase) * 0.035,
      ry: 0.052 + Math.abs(phase) * 0.018,
      rotate: -0.12 + phase * 0.12,
      opacity: 0.1 + (1 - Math.abs(phase)) * 0.58,
      width: index % 4 === 0 ? 1.35 : 0.82,
      wobble: 0.01,
      speed: 0.8
    };
  }

  if (stage === 1) {
    return {
      x: 0.72 + phase * 0.055,
      y: 0.43 + wave * 0.03,
      rx: 0.04 + Math.abs(phase) * 0.025,
      ry: 0.26 - Math.abs(phase) * 0.036,
      rotate: -0.62 + phase * 0.35,
      opacity: 0.08 + (1 - Math.abs(phase)) * 0.5,
      width: index % 5 === 0 ? 1.35 : 0.82,
      wobble: 0.012,
      speed: 1.15
    };
  }

  if (stage === 2) {
    return {
      x: 0.72 + phase * 0.07,
      y: 0.44 + Math.sin(index * 0.46) * 0.09,
      rx: 0.055 + Math.abs(wave) * 0.05,
      ry: 0.19 - Math.abs(phase) * 0.035,
      rotate: 1.1 + phase * 0.55,
      opacity: 0.08 + (1 - Math.abs(phase)) * 0.58,
      width: index % 3 === 0 ? 1.28 : 0.78,
      wobble: 0.018,
      speed: 1.35
    };
  }

  if (stage === 3) {
    return {
      x: 0.765 + Math.cos(index * 0.54) * 0.01,
      y: 0.45 + phase * 0.038,
      rx: 0.125 - Math.abs(phase) * 0.014,
      ry: 0.085 + Math.abs(Math.sin(index * 0.42)) * 0.028,
      rotate: 0.38 + phase * 0.32,
      opacity: 0.09 + (1 - Math.abs(phase)) * 0.42,
      width: index % 4 === 0 ? 1.25 : 0.72,
      wobble: 0.018,
      speed: 1.05,
      spokes: 9,
      spokeSkew: 0.28
    };
  }

  return {
    x: 0.72 + phase * 0.036,
    y: 0.45 + Math.sin(index * 0.52) * 0.024,
    rx: 0.055 + Math.abs(phase) * 0.025,
    ry: 0.19 - Math.abs(phase) * 0.026,
    rotate: -0.42 + phase * 0.26,
    opacity: 0.1 + (1 - Math.abs(phase)) * 0.48,
    width: index % 4 === 0 ? 1.35 : 0.76,
    wobble: 0.017,
    speed: 0.9,
    spokes: 0,
    spokeSkew: 0
  };
}

function mixState(a, b, amount) {
  return {
    x: mix(a.x, b.x, amount),
    y: mix(a.y, b.y, amount),
    rx: mix(a.rx, b.rx, amount),
    ry: mix(a.ry, b.ry, amount),
    rotate: mix(a.rotate, b.rotate, amount),
    opacity: mix(a.opacity, b.opacity, amount),
    width: mix(a.width, b.width, amount),
    wobble: mix(a.wobble, b.wobble, amount),
    speed: mix(a.speed, b.speed, amount),
    spokes: amount < 0.5 ? a.spokes : b.spokes,
    spokeSkew: mix(a.spokeSkew || 0, b.spokeSkew || 0, amount)
  };
}

function mix(a, b, amount) {
  return a + (b - a) * amount;
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function renderAnalysis(data) {
  output.classList.remove("loading");
  output.innerHTML = "";

  if (data.demo) {
    const tag = document.createElement("h3");
    tag.textContent = "Demo Mode";
    output.append(tag);
  }

  const text = document.createElement("div");
  text.textContent = data.text || "No analysis was returned.";
  output.append(text);

  if (Array.isArray(data.citations) && data.citations.length > 0) {
    const list = document.createElement("ol");
    list.className = "source-list";

    for (const citation of data.citations) {
      const item = document.createElement("li");
      const link = document.createElement("a");

      link.href = citation.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = citation.title || citation.url;

      item.append(link);
      list.append(item);
    }

    output.append(list);
  }
}
