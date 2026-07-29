export type PaginationInput = {
	total: number;
	page: number;
	pageSize: number;
};

export type Pagination = {
	total: number;
	page: number;
	pageSize: number;
	totalPages: number;
	skip: number;
	take: number;
	from: number;
	to: number;
	hasPrev: boolean;
	hasNext: boolean;
};

/** Offset pagination with clamped page. Safe for admin-scale datasets. */
export function paginate({ total, page, pageSize }: PaginationInput): Pagination {
	const safeTotal = Math.max(0, Math.floor(total));
	const safeSize = Math.max(1, Math.floor(pageSize));
	const totalPages = Math.max(1, Math.ceil(safeTotal / safeSize));
	const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
	const skip = (safePage - 1) * safeSize;
	const from = safeTotal === 0 ? 0 : skip + 1;
	const to = Math.min(skip + safeSize, safeTotal);

	return {
		total: safeTotal,
		page: safePage,
		pageSize: safeSize,
		totalPages,
		skip,
		take: safeSize,
		from,
		to,
		hasPrev: safePage > 1,
		hasNext: safePage < totalPages,
	};
}
