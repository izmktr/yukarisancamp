require('ts-node').register({ files: true });
const assert = require('node:assert/strict');
const test = require('node:test');
const { canViewArticle } = require('../src/utils/boardAccess');
const service = require('../src/services/boardSupabase');
const router = require('../src/api/board').default;
const originalError = console.error;
console.error = () => {};
const pageRouter = require('../src/routes/board').default;
console.error = originalError;

const owner = { googleUserId: 'owner', discordServer: 'clan-a', displayName: 'Owner' };
const peer = { googleUserId: 'peer', discordServer: 'clan-a' };
const outsider = { googleUserId: 'outsider', discordServer: 'clan-b' };
function row(visibility = 'self', id = 'post') {
  return { id, legacy_id: id, yearmonth: '202609', author_id: 'owner', author_name: 'Owner',
    visibility, battle_time_seconds: 90, raw_article: { visibility, authorclanid: 'clan-a' } };
}
async function request(target, method, path, user, body = {}, params = { id: 'post' }) {
  const layer = target.stack.find(layer => layer.route?.path === path && layer.route.methods[method]);
  const result = { statusCode: 200 };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; },
    send(body) { result.body = body; return this; },
    render(view, data) { result.body = data; return this; }
  };
  await layer.route.stack[0].handle({ session: { user }, body, params }, res);
  return result;
}

test('visibility matrix: anonymous, owner, clan peer, outsider and missing clan', () => {
  for (const [visibility, expected] of [['all', [true,true,true,true]], ['self',[false,true,false,false]], ['clan',[false,true,true,false]]]) {
    for (const [i,user] of [undefined,owner,peer,outsider].entries()) {
      assert.equal(canViewArticle({ authorid: 'owner', visibility, authorclanid: 'clan-a' },user),expected[i]);
    }
  }
  assert.equal(canViewArticle({ visibility:'clan' },{ googleUserId:'peer' }),false);
  assert.equal(canViewArticle({ visibility:'clan', setting:{discord_server:'clan-a'} },peer),true);
  assert.equal(canViewArticle({ visibility:'unknown' },undefined),false);
});

test('API list and detail enforce visibility for each viewer', async t => {
  t.mock.method(service,'listCurrentMonthBoardPosts',async () => [row('all','public'),row('self','private'),row('clan','clan')]);
  t.mock.method(service,'getCurrentMonthBoardPostByLegacyId',async () => row());
  for (const [user,ids] of [[undefined,['public']],[owner,['public','private','clan']],[peer,['public','clan']],[outsider,['public']]]) {
    const result = await request(router,'get','/',user);
    assert.deepEqual(result.body.map(item => item.id),ids);
    assert.equal((await request(router,'get','/:id',user)).statusCode,user === owner ? 200 : 404);
  }
});

test('edit rejects anonymous and non-owner; owner cannot forge stored authorship', async t => {
  t.mock.method(service,'getCurrentClanBattleYearMonth',async () => '202609');
  t.mock.method(service,'getCurrentMonthBoardPostByLegacyId',async () => row());
  const save = t.mock.method(service,'upsertBoardPost',async input => ({ legacy_id: input.legacyId }));
  for (const [user,status] of [[undefined,401],[peer,403],[outsider,403]]) {
    assert.equal((await request(router,'post','/:id/edit',user,{article:{authorid:'owner'}})).statusCode,status);
  }
  assert.equal(save.mock.callCount(),0);
  const result = await request(router,'post','/:id/edit',owner,{article:{authorid:'forged',authorname:'forged',visibility:'clan'}});
  assert.equal(result.statusCode,200);
  const saved = save.mock.calls[0].arguments[0];
  assert.equal(saved.authorId,'owner');
  assert.equal(saved.article.authorid,'owner');
  assert.equal(saved.article.authorname,'Owner');
  assert.equal(saved.article.authorclanid,'clan-a');
});

test('missing edit target returns 404 and create endpoint cannot overwrite another author', async t => {
  t.mock.method(service,'getCurrentClanBattleYearMonth',async () => '202609');
  const lookup = t.mock.method(service,'getCurrentMonthBoardPostByLegacyId',async () => undefined);
  const save = t.mock.method(service,'upsertBoardPost',async () => ({legacy_id:'post'}));
  assert.equal((await request(router,'post','/:id/edit',owner,{article:{}})).statusCode,404);
  assert.equal((await request(router,'post','/post',undefined,{timelog:'test'})).statusCode,401);
  lookup.mock.mockImplementation(async () => row());
  t.mock.method(service,'getAnyBoardPostByLegacyId',async () => ({ ...row(), yearmonth: '202608' }));
  assert.equal((await request(router,'post','/post',peer,{timelog:'test',id:'post'})).statusCode,403);
  assert.equal(save.mock.callCount(),0);
});

test('HTML detail and all comparison endpoints deny inaccessible source posts', async t => {
  t.mock.method(service,'getCurrentMonthBoardPostByLegacyId',async () => row());
  for (const [method,path] of [['get','/:id'],['get','/:id/diff'],['post','/:id/diff/timelog'],['post','/:id/diff/article/:targetId']]) {
    for (const user of [undefined,outsider]) {
      assert.equal((await request(pageRouter,method,path,user)).statusCode,404);
    }
  }
});

test('HTML list includes same-clan posts and row authorship takes priority over raw fields', async t => {
  t.mock.method(service,'listCurrentMonthBoardPosts',async () => [row('all','public'),row('self','private'),row('clan','clan')]);
  const result = await request(pageRouter,'get','/',peer);
  assert.deepEqual(result.body.articles.map(article => article.id),['public','clan']);
  const stored = row();
  stored.raw_article.author_id = 'forged';
  stored.raw_article.authorid = 'forged';
  const article = service.boardRowToArticle(stored);
  assert.equal(article.author_id,'owner');
  assert.equal(article.authorid,'owner');
});
