import * as https from "https";
import * as http from "http";
import * as URL from "url";

import logger from "./logger";
import { InsecureRegistrySupport } from "./types";
import { OutgoingHttpHeaders } from "http";

export const redirectCodes = [308, 307, 303, 302, 301];

export function isOk(httpStatus: number) {
	return httpStatus >= 200 && httpStatus < 300;
}
type HttpMethod = "GET" | "POST" | "PUT" | "HEAD";
export function createHttpOptions(method: HttpMethod, url: string, headers: OutgoingHttpHeaders): https.RequestOptions {
	const options: https.RequestOptions = { ...URL.parse(url) };
	options.headers = headers;
	options.method = method;
	return options;
}

export function buildHeaders(accept: string, auth: string): OutgoingHttpHeaders {
	const headers: OutgoingHttpHeaders = { accept: accept };
	if (auth) headers.authorization = auth;
	return headers;
}
export function request(
	options: https.RequestOptions,
	allowInsecure: InsecureRegistrySupport,
	callback: (res: http.IncomingMessage) => void,
) {
	if (allowInsecure == InsecureRegistrySupport.YES) options.rejectUnauthorized = false;
	const req = (options.protocol == "https:" ? https : http).request(options, (res) => {
		callback(res);
	});
	req.on("error", (e) => {
		logger.error("ERROR: " + e, options.method, options.path);
		throw e;
	});
	return req;
}

export function toError(res: http.IncomingMessage) {
	return `Unexpected HTTP status ${res.statusCode} : ${res.statusMessage}`;
}

export function waitForResponseEnd(res: http.IncomingMessage, cb: (data: Buffer) => void) {
	const data: Buffer[] = [];
	res.on("data", (d) => data.push(d));
	res.on("end", () => cb(Buffer.concat(data)));
}

function dl(uri: string, headers: OutgoingHttpHeaders, allowInsecure: InsecureRegistrySupport): Promise<string> {
	logger.debug("dl", uri);
	return new Promise((resolve, reject) => {
		followRedirects(uri, headers, allowInsecure, (result) => {
			if ("error" in result) return reject(result.error);
			const { res } = result;
			logger.debug(res.statusCode, res.statusMessage, res.headers["content-type"], res.headers["content-length"]);
			if (!isOk(res.statusCode ?? 0)) return reject(toError(res));
			waitForResponseEnd(res, (data) => resolve(data.toString()));
		});
	});
}

export async function dlJson<T>(
	uri: string,
	headers: OutgoingHttpHeaders,
	allowInsecure: InsecureRegistrySupport,
): Promise<T> {
	const data = await dl(uri, headers, allowInsecure);
	return JSON.parse(Buffer.from(data).toString("utf-8"));
}

type Callback = (result: { error: string } | { res: http.IncomingMessage }) => void;

export function followRedirects(
	uri: string,
	headers: OutgoingHttpHeaders,
	allowInsecure: InsecureRegistrySupport,
	cb: Callback,
	count = 0,
) {
	logger.debug("rc", uri);
	const options = createHttpOptions("GET", uri, headers);
	request(options, allowInsecure, (res) => {
		if (redirectCodes.includes(res.statusCode ?? 0)) {
			if (count > 10) return cb({ error: "Too many redirects for " + uri });
			const location = res.headers.location;
			if (!location) return cb({ error: "Redirect, but missing location header" });
			return followRedirects(location, headers, allowInsecure, cb, count + 1);
		}
		cb({ res });
	}).end();
}
