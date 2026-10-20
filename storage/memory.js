// Contrato assíncrono. Entradas e saídas são cópias JSON independentes.
// Para persistir em banco, substitua somente esta implementação e mantenha os quatro métodos.
export class MemoryStorage {
  #rooms = new Map();
  async getRoom(code) { return structuredClone(this.#rooms.get(code) ?? null); }
  async saveRoom(room) { this.#rooms.set(room.code, structuredClone(room)); }
  async deleteRoom(code) { this.#rooms.delete(code); }
  async listRooms() { return structuredClone([...this.#rooms.values()]); }
}
export default new MemoryStorage();
