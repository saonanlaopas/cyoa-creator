import {
  NativePlayerError,
  NATIVE_PLAYER_LIMITS,
  NativePlayerSaveSchema,
  assertNativePlayerInstallation,
  assertNativePlayerManualSlot,
  type NativePlayerInstallation,
  type NativePlayerManualSlot,
  type NativePlayerSave,
  type NativePlayerStorage,
} from "@story-to-cyoa/runtime";

const DATABASE_NAME = "story-to-cyoa-native-player-v1";
const DATABASE_VERSION = 1;
const INSTALLATIONS = "installations";
const AUTOSAVES = "autosaves";
const MANUAL_SLOTS = "manualSlots";

interface StoredValue { key: string; gameId: string; value: unknown }

export class IndexedDbNativePlayerStorage implements NativePlayerStorage {
  public constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  async install(value: NativePlayerInstallation): Promise<void> {
    const checked = assertNativePlayerInstallation(value);
    await this.put(INSTALLATIONS, {
      key: gameNamespace(checked.gameId, checked.bundleFingerprint), gameId: checked.gameId, value: checked,
    });
  }

  async readInstallation(gameId: string, bundleFingerprint: string): Promise<unknown | null> {
    return this.read(INSTALLATIONS, gameNamespace(gameId, bundleFingerprint));
  }

  async writeAutosave(gameId: string, bundleFingerprint: string, value: NativePlayerSave): Promise<void> {
    const parsed = NativePlayerSaveSchema.safeParse(value);
    if (!parsed.success || parsed.data.gameId !== gameId || parsed.data.bundleFingerprint !== bundleFingerprint) {
      throw new NativePlayerError("save_state_invalid", "Autosave identity is invalid");
    }
    await this.put(AUTOSAVES, { key: gameNamespace(gameId, bundleFingerprint), gameId, value: parsed.data });
  }

  async readAutosave(gameId: string, bundleFingerprint: string): Promise<unknown | null> {
    return this.read(AUTOSAVES, gameNamespace(gameId, bundleFingerprint));
  }

  async writeManualSlot(value: NativePlayerManualSlot): Promise<void> {
    const checked = assertNativePlayerManualSlot(value);
    const key = manualNamespace(checked.gameId, checked.bundleFingerprint, checked.slotId);
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(MANUAL_SLOTS, "readwrite");
      const store = transaction.objectStore(MANUAL_SLOTS);
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result as StoredValue[];
        if (!records.some((item) => item.key === key)
          && records.filter((item) => item.gameId === checked.gameId).length >= NATIVE_PLAYER_LIMITS.maximumManualSlots) {
          transaction.abort();
          reject(new NativePlayerError("storage_quota_exceeded", "Manual save-slot limit reached"));
          return;
        }
        store.put({ key, gameId: checked.gameId, value: structuredClone(checked) });
      };
      request.onerror = () => reject(storageError(request.error));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(storageError(transaction.error));
      transaction.onabort = () => {
        if (transaction.error) reject(storageError(transaction.error));
      };
    }).finally(() => database.close());
  }

  async listManualSlots(gameId: string): Promise<unknown[]> {
    const database = await this.open();
    return new Promise<unknown[]>((resolve, reject) => {
      const transaction = database.transaction(MANUAL_SLOTS, "readonly");
      const request = transaction.objectStore(MANUAL_SLOTS).getAll();
      request.onsuccess = () => resolve((request.result as StoredValue[])
        .filter((item) => item.gameId === gameId).map((item) => structuredClone(item.value)));
      request.onerror = () => reject(storageError(request.error));
      transaction.onabort = () => reject(storageError(transaction.error));
    }).finally(() => database.close());
  }

  async deleteManualSlot(gameId: string, slotId: string, bundleFingerprint: string): Promise<void> {
    await this.remove(MANUAL_SLOTS, manualNamespace(gameId, bundleFingerprint, slotId));
  }

  private async open(): Promise<IDBDatabase> {
    if (!this.factory) throw new NativePlayerError("storage_unavailable", "Browser save storage is unavailable");
    return new Promise((resolve, reject) => {
      const request = this.factory!.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of [INSTALLATIONS, AUTOSAVES, MANUAL_SLOTS]) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () => reject(new NativePlayerError(
        "storage_transaction_failed", "Browser save storage upgrade is blocked by another tab",
      ));
    });
  }

  private async read(storeName: string, key: string): Promise<unknown | null> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result ? structuredClone((request.result as StoredValue).value) : null);
      request.onerror = () => reject(storageError(request.error));
      transaction.onabort = () => reject(storageError(transaction.error));
    }).finally(() => database.close());
  }

  private async put(storeName: string, value: StoredValue): Promise<void> {
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(structuredClone(value));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(storageError(transaction.error));
      transaction.onabort = () => reject(storageError(transaction.error));
    }).finally(() => database.close());
  }

  private async remove(storeName: string, key: string): Promise<void> {
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(storageError(transaction.error));
      transaction.onabort = () => reject(storageError(transaction.error));
    }).finally(() => database.close());
  }
}

function storageError(error: DOMException | null): NativePlayerError {
  if (error?.name === "QuotaExceededError") {
    return new NativePlayerError("storage_quota_exceeded", "Browser save storage quota was exceeded");
  }
  if (error?.name === "InvalidStateError" || error?.name === "NotSupportedError" || error?.name === "SecurityError") {
    return new NativePlayerError("storage_unavailable", "Browser save storage is unavailable", error?.name);
  }
  return new NativePlayerError("storage_transaction_failed", "Browser save storage transaction failed", error?.name);
}

function gameNamespace(gameId: string, bundleFingerprint: string): string {
  return `${gameId}:${bundleFingerprint}`;
}

function manualNamespace(gameId: string, bundleFingerprint: string, slotId: string): string {
  return `${gameNamespace(gameId, bundleFingerprint)}:${slotId}`;
}
