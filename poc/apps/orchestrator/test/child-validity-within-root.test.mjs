/**
 * A Task's Child DC never outlives the operational Root: its validity is the
 * default only while the Root has enough time left, then it shrinks to fit,
 * and with too little time left the session ends with a clear message.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {childValiditySeconds,CHILD_VALIDITY_SECONDS}
 from "../src/canonical-owner-deployment.mjs";

const NOW=Date.parse("2026-11-13T09:00:00.000Z");
const at=seconds=>new Date(NOW+seconds*1000).toISOString();

test("default Child validity while the Root has more time left",()=>{
 assert.equal(childValiditySeconds(at(3600),NOW),CHILD_VALIDITY_SECONDS);
});

test("Child validity shrinks to end before the Root (session s-2c477b28eb09)",()=>{
 // Root expiring 19 minutes after the Task: the old fixed 20 minutes failed.
 const seconds=childValiditySeconds(at(19*60),NOW);
 assert.equal(seconds,19*60-30);
 assert.ok(NOW+seconds*1000<Date.parse(at(19*60)));
});

test("too little Root time left ends the session with a clear reason",()=>{
 assert.throws(()=>childValiditySeconds(at(80),NOW),/Root operativa sta per scadere/u);
 assert.throws(()=>childValiditySeconds(at(-5),NOW),/Root operativa sta per scadere/u);
});

test("a missing or malformed expiry is refused",()=>{
 for(const value of [undefined,"","not-a-date",123])
  assert.throws(()=>childValiditySeconds(value,NOW),/configuration denied/u);
});
