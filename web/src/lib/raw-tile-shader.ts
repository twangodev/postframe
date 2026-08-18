/**
 * Reads the shape of a WGSL program without a GPU: which bindings it declares,
 * which develop stages its adjustment chain calls, and where each member of a
 * uniform struct lands under the WGSL layout rules. Nothing at runtime checks
 * these against the renderer, so a test does.
 */

const SCALAR_BYTES = 4;

const VECTOR_LAYOUT: Record<string, { size: number; align: number }> = {
	vec2: { size: 8, align: 8 },
	vec3: { size: 12, align: 16 },
	vec4: { size: 16, align: 16 }
};

export function shaderBindings(shader: string) {
	return [...shader.matchAll(/@binding\((\d+)\)/g)]
		.map(([, index]) => Number(index))
		.sort((left, right) => left - right);
}

/**
 * The stage functions `apply_adjustments` calls, in the order their results
 * flow. A stage nested as another's argument runs first, so it is listed first.
 */
export function shaderStageCalls(shader: string) {
	const body = functionBody(shader, 'apply_adjustments');
	return [...body.matchAll(/=\s*((?:apply_\w+\()+)/g)].flatMap(([, calls]) =>
		[...calls.matchAll(/apply_\w+/g)].map(([name]) => name).reverse()
	);
}

export function uniformLayout(shader: string, struct: string) {
	const declaration = shader.match(new RegExp(`struct\\s+${struct}\\s*\\{([^}]*)\\}`));
	if (!declaration) throw new Error(`no struct ${struct} in shader`);
	const offsets: Record<string, number> = {};
	let cursor = 0;
	let structAlign = 1;
	for (const member of declaration[1].split(',')) {
		const field = member.trim().match(/^(\w+)\s*:\s*(\w+)(?:<\w+>)?$/);
		if (!field) continue;
		const [, name, kind] = field;
		const { size, align } = VECTOR_LAYOUT[kind] ?? { size: SCALAR_BYTES, align: SCALAR_BYTES };
		cursor = roundUp(cursor, align);
		offsets[name] = cursor;
		cursor += size;
		structAlign = Math.max(structAlign, align);
	}
	return { offsets, size: roundUp(cursor, structAlign) };
}

function functionBody(shader: string, name: string) {
	const start = shader.indexOf(`fn ${name}(`);
	if (start === -1) throw new Error(`no function ${name} in shader`);
	const open = shader.indexOf('{', start);
	let depth = 0;
	for (let index = open; index < shader.length; index += 1) {
		if (shader[index] === '{') depth += 1;
		if (shader[index] === '}' && (depth -= 1) === 0) return shader.slice(open, index + 1);
	}
	throw new Error(`unterminated function ${name}`);
}

function roundUp(value: number, multiple: number) {
	return Math.ceil(value / multiple) * multiple;
}
