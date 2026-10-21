import test from "node:test";
import assert from "node:assert/strict";
import {assertCanDeleteAccounts,deletedUserEmail} from "../app/users/account-lifecycle.ts";

const tx=(activeAdmins)=>({prepare(sql){assert.match(sql,/COUNT\(\*\)/);return{async first(){return{count:activeAdmins};}};}});
const target=(id,role_name,status="active")=>({id,role_name,status});
const status=async(action,expected)=>assert.rejects(action,error=>error instanceof Response&&error.status===expected);

test("account deletion protects self, privileged roles and the last administrator",async()=>{
  await status(()=>assertCanDeleteAccounts(tx(2),{id:4,role_name:"Super Admin"},[target(4,"Super Admin")]),400);
  await status(()=>assertCanDeleteAccounts(tx(2),{id:4,role_name:"HR Manager"},[target(5,"HR Manager")]),403);
  await status(()=>assertCanDeleteAccounts(tx(1),{id:4,role_name:"Super Admin"},[target(5,"Super Admin")]),409);
  await assertCanDeleteAccounts(tx(2),{id:4,role_name:"Super Admin"},[target(5,"Super Admin")]);
  await assertCanDeleteAccounts(tx(1),{id:4,role_name:"HR Manager"},[target(5,"Employee")]);
});

test("deleted login names are unique and cannot be mistaken for the original work email",()=>{
  assert.notEqual(deletedUserEmail(10),deletedUserEmail(11));
  assert.notEqual(deletedUserEmail(10),"worker@example.invalid");
});
