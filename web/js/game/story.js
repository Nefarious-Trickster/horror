import * as THREE from 'three';
import * as P from '../world/props.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const NOTES = {
  intake: {
    title: 'Intake memo — Block 13',
    body: `<p>To all night staff.</p>
<p>Effective immediately the 02:00 resident count is to be conducted in pairs. Do not count aloud. Do not count the corridors. If your total differs from the ledger, record the <b>ledger</b> figure and inform Dr. Varga in person.</p>
<p>Do not discuss discrepancies with residents.</p>
<p>— Administration, 14 Oct 1987</p>
<p><span class="scrawl">we stopped doing it in pairs. it was worse in pairs</span></p>`,
  },
  washroom: {
    title: 'Torn page, wedged behind a cistern',
    body: `<p>they turn the lights off for count and the thing from the hydro room walks the beds.</p>
<p>it touches each of us on the forehead. one. two. three.</p>
<p>it was so happy when it got to 41.</p>
<p><span class="scrawl">then it kept going</span></p>`,
  },
  ward: {
    title: 'Diary — Resident 17',
    body: `<p>Nurse Adler says there are forty of us. I counted forty-one at breakfast. The new one sits at the end of the table and doesn't eat. It has no eyes. Just a mouth that is always almost smiling.</p>
<p>When I look at it, it holds up fingers. Too many fingers.</p>
<p>I took one of the big fuses out of the generator so they can't put the lights on for count. <b>It's in my bedside drawer, the last bed by the back door.</b> Without the lights it can't see us. It only sees light.</p>`,
  },
  hydro: {
    title: 'Hydrotherapy log',
    body: `<p><b>Continuous immersion, tubs 1–5.</b></p>
<p>23:00 — Patient in tub 4 agitated, attempted to count the tubs aloud. Sedated.</p>
<p>02:10 — Tub 4 found empty. Water still warm. Canvas cover intact.</p>
<p>Second generator fuse missing from stores. Orderly Bram swears it went into <b>tub 4</b> while he was restraining. Nobody is reaching in there. Not after what Bram said took hold of his hand.</p>`,
  },
  enumerator: {
    title: 'Field notebook — D. Hale, enumerator, 1997',
    body: `<p>Registered residents, Block 13: <b>41</b>. Nobody has been down here in ten years. The service lift dropped me.</p>
<p>Generator wants <b>both fuses seated</b> and the lever thrown. Power works the intake gate. The gate is the only way to the freight lift.</p>
<p>Something counts in the dark. When it gets close it says a number. I heard it say forty-two.</p>
<p><span class="scrawl">if you read this — keep your light OFF when it's near. it hunts the light. it hunts sound.</span></p>`,
  },
  varga: {
    title: 'Memorandum — Dr. I. Varga, Director',
    body: `<p>The count must not be allowed to reach 42.</p>
<p>Each time it finishes a count it adds one, and the one it adds is whoever was counting. I have tied the pump interlock to the night count so that nobody can drain the lift pit and leave until the number is right.</p>
<p>My keycard for the pump station is with Henrik. With what is left of Henrik.</p>
<p><b>Cold storage, drawer 7.</b></p>`,
  },
  ledger: {
    title: 'Night count ledger — Ward C',
    body: `<p>26 Oct ........ 38<br/>27 Oct ........ 39<br/>28 Oct ........ 40<br/>29 Oct ........ 41<br/>30 Oct ........ 41 &nbsp;(recount 41) (recount 41)<br/>31 Oct ........ <span class="scrawl">it adds one. it ALWAYS adds one</span></p>
<p style="margin-top:22px;font-size:13px">PUMP INTERLOCK accepts tonight's count only. 4 digits.</p>
<p><span class="scrawl">41 of them. and whoever is holding the pen.</span></p>`,
  },
  archive: {
    title: 'Scrap of a duty roster',
    body: `<p>Bram counted the morgue drawers to keep calm. Fifteen drawers.</p><p>He opened sixteen.</p>`,
  },
  autopsy: {
    title: "Post-mortem — 'Resident 42' (unidentified)",
    body: `<p>Specimen recovered from the deep tank, 29 Oct. Height 2.6 m. No eyes — orbits sealed over with skin. Mandible articulates beyond 110°. Hands: five digits, eleven joints each.</p>
<p>Forty-one distinct dental impressions found in the jaw. One for each resident.</p>
<p>The specimen was not dead.</p>
<p><span class="scrawl">the specimen is not here</span></p>`,
  },
  pump: {
    title: 'Lift pit drainage — procedure',
    body: `<p>1. Enter the night count at the interlock (north console).</p>
<p>2. Pumps run approx. 45 s. <b>Pumps are loud.</b> Keep clear.</p>
<p>3. When the pit is clear, call the freight lift from the B13 panel in the east service corridor. Lift travel time approx. 30 s.</p>`,
  },
};

const TAPE = [
  [0, '<i>[tape hiss]</i>'],
  [2.5, 'Varga. October thirty-first.'],
  [5.5, "The ledger says forty-one. It has said forty-one since the night we opened the deep tank."],
  [10.5, 'We count them every night because it needs to be counted—'],
  [14.5, '…no. Because it needs <i>us</i> to count.'],
  [18.5, "It isn't a resident. It's the act of counting, given legs."],
  [23, "If anyone hears this: don't count. And don't let it count <i>you</i>."],
  [28, '<i>[click]</i>'],
];

export class Story {
  constructor(game) {
    this.g = game;
    this.f = {
      knowsGen: false, knowsFuses: false, fusesHeld: 0, fusesIn: 0, power: false, gateOpen: false,
      liftSeen: false, keycard: false, knowsDrawer: false, pumpOpen: false, draining: false, drained: false,
      liftCalled: false, liftArrived: false, ending: false, notes: new Set(), codeTries: 0,
    };
    this.checkpoint = null;
    this.timers = [];
    this.fired = new Set();
    this.lastObjective = '';
    this.seenCooldown = 0;
  }

  // ------------------------------------------------------------------ helpers
  after(sec, fn) { this.timers.push({ t: this.g.time + sec, fn }); }
  once(id) { if (this.fired.has(id)) return false; this.fired.add(id); return true; }
  say(text, dur = 4) { this.g.hud.subtitle(text, dur); }
  saveCheckpoint() {
    const p = this.g.player;
    this.checkpoint = { x: p.pos.x, z: p.pos.z, yaw: p.yaw };
  }

  objective() {
    const f = this.f;
    if (f.ending) return '';
    if (!f.power) {
      const have = f.fusesIn + f.fusesHeld;
      if (f.fusesIn >= 2) return 'Throw the generator lever.';
      if (f.fusesHeld > 0 && f.knowsFuses) return `Seat the fuse${f.fusesHeld > 1 ? 's' : ''} in the generator panel. (${have}/2)`;
      if (f.knowsFuses) return `Find the generator's two missing fuses. (${have}/2)`;
      if (f.knowsGen) return 'Restore power. Find the generator.';
      return 'Find a way deeper into Block 13.';
    }
    if (!f.gateOpen) return 'Get back to the intake gate and open it.';
    if (!f.drained) {
      if (f.draining) return 'Survive while the lift pit drains.';
      if (!f.liftSeen) return 'Find the freight lift.';
      if (!f.pumpOpen) {
        if (f.keycard) return 'Open the pump station with the keycard.';
        if (f.knowsDrawer) return 'Cold storage, drawer 7. Find Varga\'s keycard.';
        return 'Get into the pump station. Find a keycard.';
      }
      return 'Enter the night count at the pump interlock.';
    }
    if (!f.liftCalled) return 'Call the freight lift.';
    if (!f.liftArrived) return 'Hold on until the lift arrives.';
    return 'Get in the lift.';
  }
  refreshObjective(force = false) {
    const o = this.objective();
    if (o !== this.lastObjective || force) { this.lastObjective = o; if (o) this.g.hud.objective(o); }
  }

  // ------------------------------------------------------------------ setup
  init() {
    const g = this.g, W = g.world, f = this.f;
    // doors
    for (const d of W.doorList) {
      if (d.kind === 'door') {
        g.addInteract({
          box: boxAt(d.center, d.axis === 'x' ? [1, 2.2, 0.4] : [0.4, 2.2, 1]),
          prompt: () => (d.jammed ? 'Jammed' : d.target ? 'Close door' : 'Open door'),
          use: () => { if (d.jammed) { g.audio.ui('locked'); return; } d.toggle(g.player.pos.x, g.player.pos.z); },
        });
      }
      if (d.kind === 'keycard') {
        g.addInteract({
          box: boxAt(d.center, d.axis === 'x' ? [1, 2.2, 0.4] : [0.4, 2.2, 1]),
          prompt: () => (d.locked ? (f.keycard ? 'Swipe keycard' : 'Locked — keycard reader') : d.target ? 'Close door' : 'Open door'),
          use: () => {
            if (d.locked) {
              if (!f.keycard) { g.audio.ui('locked'); f.knowsPump = true; this.say('A keycard reader. The light is red.'); this.refreshObjective(); return; }
              d.locked = false; f.pumpOpen = true; g.audio.ui('beep'); this.say('The reader blinks green.'); this.refreshObjective();
              d.open(g.player.pos.x, g.player.pos.z);
              return;
            }
            d.toggle(g.player.pos.x, g.player.pos.z);
          },
        });
      }
    }
    // the washroom door and the north ward door start ajar so the corridor glimpse can happen
    W.doors.get('washroom').open(7, 18.5, false, true); W.doors.get('washroom').open01 = 1;
    W.doors.get('ward_n').open(7, 17.5, false, true); W.doors.get('ward_n').open01 = 1;
    W.doors.get('ward_gen').open(24.5, 27.5, false, true); W.doors.get('ward_gen').open01 = 1;

    // lockers
    for (const lk of W.lockers) {
      g.addInteract({
        box: boxAt(lk.pos.clone().setY(1), [0.6, 1.9, 0.6]),
        prompt: () => (g.player.hidden === lk ? 'Leave locker' : g.player.hidden ? null : 'Hide'),
        use: () => (g.player.hidden === lk ? g.exitLocker() : g.enterLocker(lk)),
        always: true,
      });
    }
    // items
    for (const it of W.items) {
      g.addInteract({
        box: new THREE.Box3().setFromObject(it.obj).expandByScalar(0.08),
        prompt: () => (it.taken ? null : it.kind === 'note' ? 'Read' : it.kind === 'bottle' ? (g.player.bottles >= 3 ? 'Hands full (3 bottles)' : 'Take bottle') : it.kind === 'battery' ? 'Take battery' : 'Take'),
        use: () => this.take(it),
        item: it,
      });
    }

    // gate panel
    const gate = W.doors.get('gate');
    g.addInteract({
      box: boxAt(W.special.gatePanel.pos, [0.3, 0.5, 0.6]),
      prompt: () => (gate.target ? null : f.power ? 'Open gate' : 'Gate control'),
      use: () => {
        if (!f.power) { g.audio.ui('locked'); this.say('The gate control is dead. No power.'); f.knowsGen = true; this.refreshObjective(); return; }
        this.openGate();
      },
    });
    // generator panel
    const gen = W.special.generator;
    g.addInteract({
      box: boxAt(gen.panelPos, [1.1, 1.0, 0.5]),
      prompt: () => (f.power ? null : f.fusesIn >= 2 ? 'Throw the lever' : f.fusesHeld > 0 ? 'Seat fuse' : 'Inspect generator panel'),
      use: () => this.useGenerator(),
    });
    // fuse drawer (ward)
    const fd = W.special.fuseDrawer;
    const fuse1 = P.fuse(g.kit); fuse1.position.set(0, 0.03, -0.12); fd.drawer.add(fuse1);
    g.addInteract({
      box: boxAt(fd.pos, [0.5, 0.35, 0.5]),
      prompt: () => (fd.taken ? null : 'Search drawer'),
      use: () => {
        fd.taken = true; g.audio.doorOpen(fd.pos, false);
        g.anim((t) => { fd.drawer.position.z = 0.21 + Math.min(1, t * 3) * 0.28; return t < 0.4; });
        this.after(0.5, () => { fuse1.visible = false; this.gainFuse(); });
      },
    });
    // fuse tub
    const ft = W.special.fuseTub;
    g.addInteract({ box: boxAt(ft.pos, [0.8, 0.5, 1.6]), prompt: () => (ft.taken ? null : 'Reach into the water'), use: () => this.reachIntoTub() });
    // tape recorder
    const tape = W.special.tape;
    g.addInteract({ box: boxAt(tape.pos, [0.5, 0.25, 0.4]), prompt: () => (tape.playing ? null : 'Play tape'), use: () => this.playTape() });
    // drawer 7
    const d7 = W.special.drawer7;
    g.addInteract({
      box: boxAt(d7.pos, [0.5, 0.6, 0.8]),
      prompt: () => (!d7.opened ? 'Open drawer 7' : !f.keycard ? 'Take the toe tag' : null),
      use: () => this.useDrawer7(),
    });
    // keypad
    g.addInteract({
      box: boxAt(W.special.keypad.pos, [0.4, 0.5, 0.4]),
      prompt: () => (f.drained || f.draining ? null : 'Use interlock keypad'),
      use: () => { if (!f.power) { this.say('Dead.'); return; } g.openKeypad(); },
    });
    // lift call panel
    g.addInteract({
      box: boxAt(W.special.liftPanel.pos, [0.3, 0.5, 0.4]),
      prompt: () => (f.liftCalled ? null : 'Call lift'),
      use: () => this.callLift(),
    });
    g.addInteract({
      box: boxAt(W.special.carPanel.pos, [0.3, 0.5, 0.4]),
      prompt: () => (f.liftArrived && !f.ending ? 'Go up' : null),
      use: () => this.ride(),
    });
    // curtain bed
    const cb = W.special.curtainBed;
    g.addInteract({
      box: boxAt(V(21, 1.2, 17.4), [1.5, 2, 0.4]),
      prompt: () => (cb.opened ? null : 'Pull back the curtain'),
      use: () => {
        cb.opened = true; g.audio.ui('paper');
        g.anim((t) => { cb.group.position.x = 21 + Math.min(1, t * 2) * 1.2; cb.group.scale.x = 1 - Math.min(1, t * 2) * 0.6; return t < 0.6; });
        this.after(0.7, () => this.say('Empty. Scratched into the mattress, over and over: <i>41 41 41 41 42</i>', 5));
      },
    });

    this.saveCheckpoint();
  }

  // ------------------------------------------------------------------ actions
  take(it) {
    const g = this.g, f = this.f;
    if (it.taken) return;
    if (it.kind === 'note') {
      g.openNote(it.noteId);
      if (!f.notes.has(it.noteId)) {
        f.notes.add(it.noteId);
        if (it.noteId === 'varga') { f.knowsDrawer = true; }
        if (it.noteId === 'enumerator' || it.noteId === 'hydro' || it.noteId === 'ward') { f.knowsGen = true; }
        this.refreshObjective();
      }
      return; // notes stay in the world; re-readable
    }
    if (it.kind === 'bottle') { if (g.player.bottles >= 3) return; g.player.bottles++; g.hud.pickup('Glass bottle — <kbd>LMB</kbd> to throw. The noise draws it away.'); }
    if (it.kind === 'battery') { g.player.battery = Math.min(1, g.player.battery + 0.5); g.hud.pickup('Battery — flashlight recharged'); }
    it.taken = true; it.obj.visible = false;
    g.audio.ui('pickup');
    g.hud.inventory();
  }

  gainFuse() {
    const f = this.f;
    f.fusesHeld++; f.knowsFuses = true; f.knowsGen = true;
    this.g.audio.ui('pickup');
    this.g.hud.pickup('Generator fuse');
    this.g.hud.inventory();
    this.refreshObjective();
  }

  useGenerator() {
    const g = this.g, f = this.f, gen = g.world.special.generator;
    if (f.power) return;
    if (f.fusesIn >= 2) { this.startGenerator(); return; }
    if (f.fusesHeld > 0) {
      const i = f.fusesIn;
      const fu = P.fuse(g.kit); fu.position.set(0, 0, 0.05); gen.sockets[i].add(fu);
      gen.lamps[i].material = g.mats.get('ledGreen');
      f.fusesHeld--; f.fusesIn++;
      g.audio.ui('click'); g.audio.bang(gen.panelPos, 0.15);
      this.say(f.fusesIn >= 2 ? 'Both fuses seated. The lever is free.' : 'One fuse seated. One socket still empty.');
      g.hud.inventory();
      this.refreshObjective();
      return;
    }
    f.knowsFuses = true; f.knowsGen = true;
    this.say('Two fuse sockets, both empty. Someone pulled them out.');
    this.refreshObjective();
  }

  startGenerator() {
    const g = this.g, f = this.f, gen = g.world.special.generator, W = g.world;
    f.power = true;
    g.anim((t) => { gen.lever.rotation.x = 0.6 - Math.min(1, t * 4) * 1.4; return t < 0.3; });
    g.audio.bang(gen.panelPos, 0.5);
    // cranking
    [0.4, 1.0, 1.5, 1.9].forEach((t, i) => this.after(t, () => { g.audio.bang(V(24.6, 1, 35), 0.4 + i * 0.15); g.player.shake = 0.3; }));
    this.after(2.2, () => {
      g.genLoop = g.audio.loop('generator', V(24.6, 1, 35), { gain: 1.2, ref: 3, rolloff: 0.7 });
      g.lights.power = true;
      g.lights.blackout = 0;
      g.audio.buzz(V(24, 3, 31), 0.6);
      g.world.doors.get('gate').locked = false;
      W.special.gatePanel.led.material = g.mats.get('ledGreen');
      g.emitNoise(24.6, 35, 40, 'generator');
      g.hud.flashLights?.();
      this.after(1.0, () => this.say('The lights come up. Somewhere far above, the gate motor clunks awake.', 4.5));
    });
    // it wakes
    this.after(6.0, () => {
      const p = W.special.hydroWaterPos;
      g.audio.bang(p, 1.2);
      g.audio.screech(p, 2.4, 1);
      g.audio.stinger('swell');
      g.player.shake = 0.6;
      g.monster.restrictZones = ['L', 'C', 'W', 'B', 'H', 'G'];
      g.monster.activate(13.8, 34.6, 'investigate');
      g.monster.teleport(13.8, 34.6, Math.PI / 2);
      g.monster.investigateTarget = V(24.5, 0, 32);
      g.monster.menace = 0.4;
      g.monster.grace = 2;
      this.after(1.6, () => this.say('<i>Something hauls itself out of the water next door.</i>', 4));
      this.refreshObjective();
      this.saveCheckpoint();
    });
    this.refreshObjective();
  }

  openGate() {
    const g = this.g, f = this.f;
    const gate = g.world.doors.get('gate');
    gate.open(g.player.pos.x, g.player.pos.z);
    g.emitNoise(15, 5, 22, 'gate');
    f.gateOpen = true;
    this.after(3.4, () => { g.monster.restrictZones = null; this.refreshObjective(); this.saveCheckpoint(); });
  }

  reachIntoTub() {
    const g = this.g, ft = g.world.special.fuseTub;
    if (ft.taken) return;
    ft.taken = true;
    g.player.frozen = true;
    g.player.lookTarget = ft.pos.clone().setY(0.6);
    g.hud.dim(0.75);
    g.audio.heartbeat(0.7);
    for (let i = 0; i < 5; i++) this.after(0.3 + i * 0.45, () => { g.audio.drip(ft.pos); if (i % 2) g.audio.heartbeat(0.7); });
    this.after(1.4, () => this.say('<i>Cold. Something soft and slick on the bottom. Hair.</i>', 2.5));
    this.after(2.8, () => {
      g.player.frozen = false; g.player.lookTarget = null; g.hud.dim(0);
      this.gainFuse();
      // the lights die and something wades toward you
      this.after(1.2, () => {
        g.lights.blackout = 7.5;
        g.player.flickerOverride = 0;
        g.audio.buzz(V(6, 3, 35), 0.3);
        g.audio.stinger('low');
        const start = V(11, 0.5, 35.4), end = g.player.pos.clone();
        for (let i = 0; i < 8; i++) {
          this.after(0.6 + i * 0.55, () => {
            const t = i / 7;
            const p = start.clone().lerp(end, t * 0.85);
            g.audio.footstep('water', 1.2, p, true);
          });
        }
        this.after(5.2, () => g.audio.whisperCount(g.player.camera.position.clone().add(V(0.4, 0, 0.4)), 3));
        this.after(7.2, () => { g.player.flickerOverride = null; g.audio.stinger('reveal', 0.6); this.say('<i>…nothing there.</i>', 2.5); });
      });
    });
  }

  playTape() {
    const g = this.g, tape = g.world.special.tape;
    if (tape.playing) return;
    tape.playing = true;
    g.audio.ui('click');
    g.audio.intercom(tape.pos, 29);
    for (const [t, line] of TAPE) this.after(t, () => this.say(line, 4.2));
    g.anim((t) => { for (const r of tape.reels) r.rotation.y = t * 4; return t < 29; });
    this.after(29.5, () => { tape.playing = false; });
    g.emitNoise(tape.pos.x, tape.pos.z, 9, 'tape');
  }

  useDrawer7() {
    const g = this.g, d7 = g.world.special.drawer7, f = this.f;
    if (!d7.opened) {
      d7.opened = true;
      g.audio.doorOpen(d7.pos, false);
      d7.tray.visible = true;
      g.anim((t) => {
        const k = Math.min(1, t * 1.5);
        d7.door.rotation.y = -k * 1.6;
        d7.tray.position.z = Math.min(1, Math.max(0, t - 0.4) * 1.2) * 1.75;
        return t < 1.6;
      });
      this.after(1.5, () => this.say('A body under a sheet. A paper tag on the toe, and something clipped to it.', 4));
      return;
    }
    if (!f.keycard) {
      f.keycard = true;
      g.audio.ui('pickup');
      g.hud.pickup('Dr. Varga\'s keycard');
      g.hud.inventory();
      this.refreshObjective();
      this.saveCheckpoint();
      // drawer 12 answers
      const d12 = g.world.special.drawer12;
      [1.2, 1.9, 2.4].forEach((t) => this.after(t, () => { g.audio.bang(d12.pos, 0.55); g.player.shake = 0.25; }));
      this.after(3.4, () => {
        g.anim((t) => { d12.door.rotation.y = -Math.min(1, t * 0.35) * 1.3; return t < 4; });
        g.audio.doorOpen(d12.pos, false);
        g.audio.whisperCount(d12.pos, 4);
        g.emitNoise(32, 30, 40, 'morgue');
      });
    }
  }

  submitCode(code) {
    const g = this.g, f = this.f;
    const n = parseInt(code, 10);
    if (n === 42) {
      g.audio.ui('beep');
      this.say('The interlock releases. Somewhere below, the pumps shudder to life.', 4);
      this.startDrain();
      return true;
    }
    f.codeTries++;
    g.audio.ui('error');
    // alarm buzzer: loud
    g.audio.buzz(g.world.special.keypad.pos, 1.2);
    g.emitNoise(50.6, 25, 30, 'alarm');
    if (f.codeTries === 1) this.say('<i>Rejected.</i> The buzzer echoes down every corridor.', 4);
    if (f.codeTries === 2) this.say('<i>41 of them. And whoever is holding the pen.</i>', 5);
    return false;
  }

  startDrain() {
    const g = this.g, f = this.f, W = g.world;
    f.draining = true;
    this.refreshObjective();
    this.saveCheckpoint();
    const loops = [g.audio.loop('pump', V(50.4, 1, 27.6), { gain: 1.4, ref: 3, rolloff: 0.6 }), g.audio.loop('pump', V(50.4, 1, 32.4), { gain: 1.4, ref: 3, rolloff: 0.6 })];
    const water = W.special.sumpWater;
    const y0 = water.position.y;
    const DUR = 45;
    g.anim((t) => {
      water.position.y = y0 - Math.min(1, t / DUR) * 0.7;
      for (const n of W.special.pumpNeedles) n.rotation.z = 2.2 - Math.min(1, t / 3) * 3 + Math.sin(t * 9) * 0.05;
      return t < DUR;
    });
    for (let t = 0; t < DUR; t += 3) this.after(t, () => g.emitNoise(50.4, 30, 38, 'pump'));
    this.after(4, () => { if (g.monster.active && g.monster.state !== 'chase') g.monster.setState('investigate', V(52, 0, 30)); });
    this.after(DUR, () => {
      for (const l of loops) l.stop(1.5);
      f.draining = false; f.drained = true;
      g.audio.bang(V(50, 1, 30), 0.6);
      for (const fx of W.fixtures.liftBeacon) { fx.mode = 'pulse'; }
      this.say('The pumps wind down. Far off, an amber beacon starts to turn.', 4);
      this.refreshObjective();
      this.saveCheckpoint();
    });
  }

  callLift() {
    const g = this.g, f = this.f, W = g.world;
    if (!f.drained) {
      g.audio.ui('error');
      if (!f.liftSeen) { f.liftSeen = true; this.say('The panel lights a single line: <i>PIT FLOODED — PUMP INTERLOCK ENGAGED.</i>', 5); this.refreshObjective(); }
      else this.say('<i>PIT FLOODED.</i> The pump station is down the corridor.', 3);
      return;
    }
    f.liftCalled = true;
    W.special.liftPanel.button.material = g.mats.get('amber');
    g.audio.ui('beep');
    this.refreshObjective();
    const pos = V(61, 1.5, 19);
    const loop = g.audio.loop('lift', pos, { gain: 0.6, ref: 4, rolloff: 0.5 });
    this.say('Machinery groans somewhere above. It is coming down. Slowly.', 4);
    g.emitNoise(57, 19, 45, 'lift');
    this.after(9, () => {
      // the corridor goes dark and it comes for you
      g.lights.zoneKill.add('C');
      g.audio.buzz(V(57, 3, 19), 0.5);
      g.audio.stinger('swell');
      if (g.monster.active) { g.monster.setState('investigate', g.player.pos.clone()); g.monster.menace = 1; }
    });
    this.after(16, () => { if (g.monster.active && g.monster.state !== 'chase') { g.monster.awareness = 1; g.monster.lastKnown.copy(g.player.pos); g.monster.setState('chase'); } });
    this.after(30, () => {
      loop.stop(0.5);
      f.liftArrived = true;
      g.lights.zoneKill.delete('C');
      g.audio.bang(pos, 0.8);
      g.audio.ui('beep');
      W.doors.get('lift').locked = false;
      W.doors.get('lift').open(57, 19);
      g.audio.gateRattle(pos, 2.5);
      this.say('<b>Get in.</b>', 3);
      this.refreshObjective();
    });
  }

  ride() {
    const g = this.g, f = this.f, W = g.world;
    if (f.ending || !f.liftArrived) return;
    if (g.player.pos.x < 60.3) { this.say('Get all the way in.'); return; }
    f.ending = true;
    g.audio.ui('beep');
    const lift = W.doors.get('lift');
    lift.close(true);
    g.audio.gateRattle(V(59.5, 1.5, 19), 2.6);
    g.player.lookTarget = V(58, 1.6, 19);
    // it lunges for the closing doors
    const m = g.monster;
    m.puppet = true; m.active = false; m.root.visible = true; m.puppetMode = 'run';
    m.teleport(55.8, 19, Math.PI / 2);
    m.speed = 4;
    g.anim((t) => {
      if (t < 1.6) { m.pos.x = 55.8 + t * 1.6; m.speed = 4; m.puppetMode = 'run'; }
      else { m.puppetMode = 'attack'; m.speed = 0; }
      return t < 3;
    });
    g.audio.screech(V(57, 2, 19), 2.2, 1.2);
    g.player.shake = 0.5;
    this.after(2.4, () => { g.audio.bang(V(59.5, 1.5, 19), 1.4); g.player.shake = 1; m.root.visible = false; });
    this.after(3.0, () => {
      g.player.lookTarget = null;
      const loop = g.audio.loop('lift', V(62, 2, 19), { gain: 1 });
      g.player.shake = 0.15;
      this.say('The car lurches upward.', 3);
      this.after(4, () => { loop.stop(2); g.endGame(); });
    });
  }

  // ------------------------------------------------------------------ per-frame triggers
  update(dt) {
    const g = this.g, f = this.f, P = g.player, W = g.world;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (g.time >= this.timers[i].t) { const t = this.timers[i]; this.timers.splice(i, 1); t.fn(); }
    }
    const px = P.pos.x, pz = P.pos.z;
    const fwd = P.forward(new THREE.Vector3());

    // opening: the service lift drops away behind you
    if (g.time > 2.5 && this.once('lift_drop')) {
      g.audio.creak(W.special.elevatorSpark, true);
      this.after(1.2, () => { g.audio.bang(W.special.elevatorSpark, 1.3); g.audio.spark(W.special.elevatorSpark); g.player.shake = 0.6; g.sparks?.(W.special.elevatorSpark); });
      this.after(2.6, () => this.say('<i>The service lift is gone. Down into the dark, where you can still hear it settling.</i>', 5));
      this.after(8.5, () => { this.refreshObjective(true); });
    }

    // corridor glimpse: something crosses between the washroom and the ward
    if (!f.power && px > 6 && px < 9 && pz > 13.2 && pz < 16 && fwd.z > 0.75 && P.flashOn && !this.fired.has('glimpse')) {
      this.fired.add('glimpse');
      const fx = W.fixtures.westCorr[1]; const prev = fx.mode;
      const m = g.monster;
      m.puppet = true; m.root.visible = true; m.puppetMode = 'run';
      m.teleport(4.6, 18.4, Math.PI / 2 - 0.1);
      g.audio.footstep('linoleum', 1.4, V(6, 0, 18.3), true);
      g.anim((t) => {
        m.pos.x = 4.6 + t * 4.2; m.pos.z = 18.4 - t * 0.6; m.speed = 4.2;
        if (t > 0.3 && t < 0.4) g.audio.footstep('linoleum', 1.4, m.pos.clone(), true);
        if (t >= 1.25) { m.root.visible = false; m.puppet = false; return false; }
        return true;
      });
      g.audio.stinger('reveal', 0.8);
      P.fear = 1;
      this.after(1.35, () => { W.doors.get('ward_n').close(true); g.audio.doorOpen(W.doors.get('ward_n').center, true); fx.mode = prev; });
      this.after(3.5, () => this.say('<i>What was that.</i>', 2.5));
    }

    // curtain bed silhouette
    const cb = W.special.curtainBed;
    if (!this.fired.has('curtain')) {
      cb.mat.emissiveIntensity = f.power ? 0 : 0.55 + Math.sin(g.time * 13) * 0.04 * (Math.random() < 0.1 ? 3 : 1);
      if (Math.hypot(px - 21, pz - 17.6) < 3.4 && !f.power) {
        this.fired.add('curtain');
        g.audio.spark(cb.pos); g.audio.bang(cb.pos, 0.2);
        cb.mat.emissiveIntensity = 0;
        cb.mat.userData.sway.value = 1;
        g.anim((t) => { cb.mat.userData.sway.value = Math.max(0, 1 - t * 0.5); return t < 2; });
        this.after(0.6, () => g.audio.whisperCount(cb.pos, 5));
        g.audio.stinger('low', 0.8);
        P.fear = Math.max(P.fear, 0.7);
      }
    }

    // the mirror
    const mir = W.special.mirror;
    mir.obj.visible = px < 5.2 && pz > 14.8 && pz < 22.2;
    if (mir.obj.visible && !this.fired.has('mirror') && !f.power && fwd.x < -0.75 && px > 1.8) {
      this.mirrorLook = (this.mirrorLook || 0) + dt;
      if (this.mirrorLook > 0.7) {
        this.fired.add('mirror');
        const gh = W.special.mirrorGhost;
        gh.root.visible = true;
        gh.root.position.set(Math.min(4.6, px + 1.1), 0, pz + 0.15);
        gh.root.rotation.y = -Math.PI / 2;
        gh.pose.look.set(0, 0);
        g.audio.stinger('reveal', 0.9);
        g.audio.whisperCount(P.camera.position.clone().add(V(0.6, 0.2, 0)), 2);
        P.fear = 1;
        g.anim((t) => { gh.update(1 / 60, 0, 'still', gh.root); gh.jaw.rotation.x = 0.2 + t * 1.2; return t < 0.75; });
        this.after(0.8, () => { gh.root.visible = false; P.flickerOverride = 0; g.lights.blackout = 0.6; });
        this.after(1.5, () => { P.flickerOverride = null; });
      }
    } else this.mirrorLook = 0;

    // ward: the body under the sheet sits up? no — it was never there. just the count.
    if (pz > 15 && pz < 26 && px > 10 && px < 30 && this.once('ward_enter')) {
      this.after(2, () => g.audio.whisperCount(V(29, 1.5, 20.5), 4));
    }
    // first view of the generator
    if (px > 19 && pz > 28 && this.once('gen_enter')) { f.knowsGen = true; this.refreshObjective(); }
    // first sight of the lift
    if (px > 55 && pz > 13 && pz < 24 && f.gateOpen && this.once('lift_near')) this.say('A freight lift. The beacon is dead. There is a call panel.', 4);
    // contextual: entering the morgue with the keycard memo read
    if (px > 31 && px < 45 && pz > 24 && pz < 37 && this.once('morgue_enter')) {
      this.after(1, () => g.audio.creak(V(31.5, 1, 30), false));
    }

    // monster seen on screen: stinger with cooldown
    this.seenCooldown -= dt;
    const m = g.monster;
    if (m.active && m.root.visible && this.seenCooldown <= 0) {
      const head = m.headPos();
      const d = head.distanceTo(P.camera.position);
      if (d < 16 && g.level.los(px, pz, m.pos.x, m.pos.z)) {
        const v = head.clone().sub(P.camera.position).normalize();
        if (v.dot(fwd) > 0.82) {
          this.seenCooldown = 30;
          g.audio.stinger(d < 7 ? 'reveal' : 'low', d < 7 ? 1 : 0.7);
          P.fear = 1;
        }
      }
    }
  }
}

function boxAt(c, [sx, sy, sz]) {
  return new THREE.Box3(new THREE.Vector3(c.x - sx / 2, c.y - sy / 2, c.z - sz / 2), new THREE.Vector3(c.x + sx / 2, c.y + sy / 2, c.z + sz / 2));
}
