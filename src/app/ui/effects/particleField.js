const activeFields = new Set();

function createParticle(width, height) {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.05,
    vy: 0.2 + Math.random() * 0.35,
    radius: 0.6 + Math.random() * 1.8,
    opacity: 0.2 + Math.random() * 0.5,
  };
}

export function attachParticleField(container) {
  if (!container || activeFields.has(container)) return;
  const canvas = container.querySelector('canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = 0;
  let height = 0;
  let frameId = null;
  let lastTime = performance.now();
  const particles = [];

  function handleResize() {
    const bounds = container.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const targetCount = Math.max(24, Math.floor((width * height) / 6500));
    while (particles.length < targetCount) {
      particles.push(createParticle(width, height));
    }
    if (particles.length > targetCount) {
      particles.length = targetCount;
    }
  }

  function update(delta) {
    const drift = delta * 0.06;
    particles.forEach((particle) => {
      particle.x += particle.vx * drift;
      particle.y -= particle.vy * drift;
      particle.opacity += Math.sin(delta * 0.0005) * 0.002;
      if (particle.opacity < 0.15) particle.opacity = 0.15;
      if (particle.opacity > 0.65) particle.opacity = 0.65;
      if (particle.y + particle.radius < 0) {
        Object.assign(particle, createParticle(width, height));
        particle.y = height + particle.radius;
      }
      if (particle.x < -20 || particle.x > width + 20) {
        particle.x = Math.random() * width;
      }
    });
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    particles.forEach((particle) => {
      ctx.beginPath();
      ctx.globalAlpha = particle.opacity;
      const gradient = ctx.createRadialGradient(
        particle.x,
        particle.y,
        0,
        particle.x,
        particle.y,
        particle.radius * 6,
      );
      gradient.addColorStop(0, 'rgba(140, 170, 255, 0.9)');
      gradient.addColorStop(1, 'rgba(140, 170, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.arc(particle.x, particle.y, particle.radius * 6, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    const delta = now - lastTime;
    lastTime = now;
    update(delta);
    draw();
    frameId = requestAnimationFrame(loop);
  }

  handleResize();
  window.addEventListener('resize', handleResize);
  frameId = requestAnimationFrame(loop);

  function cleanup() {
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    window.removeEventListener('resize', handleResize);
    activeFields.delete(container);
  }

  container.__particleCleanup = cleanup;
  activeFields.add(container);
}

export function resetParticleFields() {
  activeFields.forEach((container) => {
    if (container.__particleCleanup) {
      container.__particleCleanup();
      delete container.__particleCleanup;
    }
  });
  activeFields.clear();
}
