import { createContext } from 'react';

/** The item a clicked reminder opens. A new nonce opens it again, even if it's the same item. */
export interface FocusRequest { itemId: string; nonce: number }
export const FocusItem = createContext<FocusRequest | null>(null);
