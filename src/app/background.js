import * as THREE from 'three';

export function initBackground(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 9 / 16, 0.1, 100);
  camera.position.z = 3;

  const geometry = new THREE.IcosahedronGeometry(1.4, 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x3366ff,
    wireframe: true,
    transparent: true,
    opacity: 0.25,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const light = new THREE.PointLight(0xffffff, 1.2);
  light.position.set(2, 3, 3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x335577, 0.6));

  function resize() {
    const width = canvas.clientWidth || canvas.parentElement.clientWidth;
    const height = canvas.clientHeight || canvas.parentElement.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate(time) {
    requestAnimationFrame(animate);
    mesh.rotation.x = time * 0.0002;
    mesh.rotation.y = time * 0.0003;
    material.opacity = 0.2 + 0.05 * Math.sin(time * 0.001);
    resize();
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', resize);
  resize();
  animate(0);
}
