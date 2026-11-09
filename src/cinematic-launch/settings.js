let lastResult;
export function reportCinematicResult(result) { lastResult = result; }

export function mountCinematicSettings(section, { native, capability }) {
  const label = document.createElement('h4');
  label.textContent = 'Cinematic Launch & Return';
  const description = document.createElement('p');
  description.textContent = 'When a console startup video is available, Totem plays it with sound while the game loads. Totem switches to the emulator when the video ends or the game starts producing audio. Without a startup video, Totem uses the live preview when available.';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  let revision = 0;
  section.append(label, description, status);
  return async function refresh() {
    const request = ++revision;
    const available = native && await capability().catch(() => false);
    if (request !== revision) return;
    status.textContent = !native ? 'Available in Totem for Windows.' : available
      ? 'Windows Graphics Capture is available.'
      : 'Windows Graphics Capture is unavailable. Totem can still use startup videos.';
    if (lastResult) status.textContent += ` Last launch: ${lastResult}`;
  };
}
