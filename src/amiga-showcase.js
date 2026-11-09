import { MathUtils, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { releaseShowcaseMedia, trackShowcaseMedia } from "./studio-audio.js";

const INSERT_SECONDS = 1.25;
const READ_SECONDS = 2.2;
const READ_PULSES = [[0, .26], [.34, .61], [.75, 1.05], [1.20, 1.47], [1.62, 1.93]];
const SLOT_X = 2.31;
const DISK_HALF_WIDTH = .44;
const DISK_OUTSIDE = SLOT_X + DISK_HALF_WIDTH + .10;
const DISK_SEATED = SLOT_X - DISK_HALF_WIDTH;

function addLamp(chassis, name, colour, y, z) {
  const lamp = new Mesh(new PlaneGeometry(.165, .018), new MeshBasicMaterial({
    color: colour,
    toneMapped: false,
  }));
  lamp.name = name;
  lamp.position.set(2.074, y, z);
  lamp.rotation.x = -Math.PI / 2 + .25;
  lamp.visible = false;
  chassis.add(lamp);
  return lamp;
}

export function attachAmigaShowcase(model, chassis, disk) {
  // The authored A500 drive faces +X and the floppy's shutter faces -Z.
  disk.name = "Amiga Workbench floppy";
  disk.rotation.y = Math.PI / 2;
  disk.scale.setScalar(DISK_HALF_WIDTH);
  disk.position.set(DISK_OUTSIDE, .226, -.66);
  disk.visible = false;
  chassis.add(disk);
  const audio = typeof Audio === "undefined" ? null
    : new Audio(new URL("/assets/demos/amiga-drive-read.wav", document.baseURI).href);
  if (audio) {
    audio.preload = "auto";
    audio.volume = .45;
  }
  model.userData.amigaShowcase = {
    disk, audio, elapsed: 0,
    power: addLamp(chassis, "Amiga power LED", 0xff342b, .337, .275),
    drive: addLamp(chassis, "Amiga drive LED", 0x56ff41, .316, .353),
  };
}

export function updateAmigaShowcase(showcase, active, dt, focus, reduceMotion) {
  const { disk, power, drive, audio, elapsed } = showcase;
  if (!active) {
    if (elapsed === 0) return;
    audio?.pause();
    if (audio) audio.currentTime = 0;
    showcase.elapsed = 0;
  } else {
    if (elapsed === 0 && focus < .995 && !reduceMotion) return;
    showcase.elapsed = Math.min(INSERT_SECONDS + READ_SECONDS,
      Math.max(reduceMotion ? INSERT_SECONDS : 0, elapsed + Math.max(0, dt)));
    if (elapsed < INSERT_SECONDS && showcase.elapsed >= INSERT_SECONDS && audio) {
      trackShowcaseMedia(audio);
      void audio.play().catch(() => {});
    }
  }
  const time = showcase.elapsed;
  const readTime = time - INSERT_SECONDS;
  disk.position.x = MathUtils.lerp(DISK_OUTSIDE, DISK_SEATED, MathUtils.smoothstep(time, 0, INSERT_SECONDS));
  disk.visible = time > 0 && readTime < 0;
  power.visible = time > 0;
  drive.visible = readTime >= 0 && readTime < READ_SECONDS &&
    (reduceMotion || READ_PULSES.some(([start, end]) => readTime >= start && readTime < end));
}

export function disposeAmigaShowcase(showcase) {
  const audio = showcase?.audio;
  if (!audio) return;
  releaseShowcaseMedia(audio);
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}
