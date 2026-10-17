// Content registry. Each skill file calls IX.add(skill, techniques); challenges.js calls IX.challenges(list).
window.IX = {
  lib: [], ch: [],
  add(sk, arr) {
    arr.forEach((x, i) => this.lib.push(Object.assign({ sk, id: sk + (i + 1), tier: i < 8 ? 1 : i < 16 ? 2 : 3 }, x)));
  },
  challenges(arr) {
    this.ch = arr.map((x, i) => Object.assign({ id: "x" + (i + 1) }, x));
  }
};
