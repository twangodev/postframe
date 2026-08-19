import type { WasmTodoName } from './wasm-bindings';

export interface MenuAction<A> {
	kind: 'action';
	label: string;
	action: A;
	shortcut?: string;
	checked?: boolean;
	disabled?: boolean;
}

export interface MenuTodo {
	kind: 'todo';
	label: string;
	todo: WasmTodoName;
	shortcut?: string;
	checked?: boolean;
}

export interface MenuSeparator {
	kind: 'separator';
}

export type MenuLeaf<A> = MenuAction<A> | MenuTodo | MenuSeparator;

export interface MenuSubmenu<A> {
	kind: 'submenu';
	label: string;
	items: MenuLeaf<A>[];
}

export type MenuEntry<A> = MenuLeaf<A> | MenuSubmenu<A>;

export const separator = (): MenuSeparator => ({ kind: 'separator' });

export const menuItemClass =
	'data-[highlighted]:bg-elevated data-[highlighted]:text-text data-[disabled]:text-muted/45 flex h-7 min-w-52 items-center gap-2 rounded-sm px-2 text-[12px] outline-none data-[disabled]:cursor-default';

export const menuContentClass =
	'motion-menu border-subtle bg-bg z-50 min-w-52 rounded border p-1 shadow-2xl';

export const menuSeparatorClass = 'my-1 h-px bg-subtle';
