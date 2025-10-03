let controller = null;

class WideMobileOrientationController {
  constructor(wrapper) {
    this.wrapper = wrapper;
    this.boundUpdate = this.update.bind(this);
    this.onViewportChange = () => window.requestAnimationFrame(this.boundUpdate);

    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('orientationchange', this.onViewportChange);
  }

  update() {
    const wrapper = this.wrapper;
    if (!wrapper || !wrapper.isConnected) {
      this.destroy();
      return;
    }

    const content = wrapper.querySelector('.wide-game-view');
    if (!content) {
      return;
    }

    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    wrapper.classList.toggle('wide-mobile-active', isMobile);

    if (!isMobile) {
      wrapper.classList.remove('wide-mobile-portrait', 'wide-mobile-measuring');
      wrapper.style.removeProperty('--wide-mobile-scale');
      return;
    }

    wrapper.classList.add('wide-mobile-measuring');
    wrapper.classList.remove('wide-mobile-portrait');
    wrapper.style.setProperty('--wide-mobile-scale', '1');

    const naturalWidth = content.offsetWidth;
    const naturalHeight = content.offsetHeight;

    wrapper.classList.remove('wide-mobile-measuring');

    const portrait = window.innerHeight > window.innerWidth;
    wrapper.classList.toggle('wide-mobile-portrait', portrait);

    let availableWidth = window.innerWidth;
    let availableHeight = window.innerHeight;
    if (portrait) {
      availableWidth = window.innerHeight;
      availableHeight = window.innerWidth;
    }

    const scale = Math.min(availableWidth / naturalWidth, availableHeight / naturalHeight, 1);
    wrapper.style.setProperty('--wide-mobile-scale', scale.toFixed(4));
  }

  destroy() {
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('orientationchange', this.onViewportChange);
    if (this.wrapper) {
      this.wrapper.classList.remove('wide-mobile-active', 'wide-mobile-portrait', 'wide-mobile-measuring');
      this.wrapper.style.removeProperty('--wide-mobile-scale');
    }
    this.wrapper = null;
    if (controller === this) {
      controller = null;
    }
  }
}

export function applyWideMobileOrientation(root) {
  const wrapper = root.querySelector('.wide-mobile-wrapper');

  if (!wrapper) {
    if (controller) {
      controller.destroy();
      controller = null;
    }
    return;
  }

  if (controller && controller.wrapper === wrapper) {
    controller.update();
    return;
  }

  if (controller) {
    controller.destroy();
  }

  controller = new WideMobileOrientationController(wrapper);
  controller.update();
}
