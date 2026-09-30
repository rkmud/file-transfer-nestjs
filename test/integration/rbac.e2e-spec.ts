import { Grant } from '@/modules/rbac/entities/grant.entity';
import { Permission } from '@/modules/rbac/entities/permission.entity';
import { Role } from '@/modules/rbac/entities/role.entity';
import { UserRole } from '@/modules/rbac/entities/user-role.entity';
import { User } from '@/modules/users/users.entity';
import { createTestApp, FakeClock, TestApp, useFakeClock } from '../setup';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MISSING_ID = '00000000-0000-4000-8000-0000000fffff';

describe('RBAC admin API (integration)', () => {
  let t: TestApp;
  let admin: User;
  let adminCookie: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    await t.reset();
    admin = await t.seedAdmin();
    adminCookie = t.authCookie(admin);
  });

  const roleByName = (name: string) =>
    t
      .repo(Role)
      .all()
      .find((role) => role.name === name)!;
  const permissionByName = (name: string) =>
    t
      .repo(Permission)
      .all()
      .find((permission) => permission.name === name)!;

  const as = (cookie: string) => ({
    get: (url: string) => t.http().get(url).set('Cookie', cookie),
    post: (url: string, body: object = {}) =>
      t.http().post(url).set('Cookie', cookie).send(body),
    put: (url: string, body: object = {}) =>
      t.http().put(url).set('Cookie', cookie).send(body),
    delete: (url: string) => t.http().delete(url).set('Cookie', cookie),
  });
  const api = () => as(adminCookie);

  const createRole = async (name: string, description?: string) =>
    (
      await api()
        .post('/api/admin/rbac/roles', { name, description })
        .expect(201)
    ).body;
  const createPermission = async (name: string, actions?: string[]) =>
    (
      await api()
        .post('/api/admin/rbac/permissions', { name, actions })
        .expect(201)
    ).body;
  const createGrant = async (body: object) =>
    (await api().post('/api/admin/rbac/grants', body).expect(201)).body;

  describe('roles', () => {
    it('lists roles ordered by name', async () => {
      await t.seedUser({ roles: ['auditor'] });

      const res = await api().get('/api/admin/rbac/roles').expect(200);

      expect(res.body.map((role: any) => role.name)).toEqual([
        'admin',
        'auditor',
        'user',
      ]);
    });

    it('creates, updates and deletes a role', async () => {
      const created = await createRole('editor', 'Edits documents');

      expect(created).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: 'editor',
          description: 'Edits documents',
        }),
      );
      expect(roleByName('editor')).toBeDefined();

      const updated = await api()
        .put(`/api/admin/rbac/roles/${created.id}`, {
          name: 'writer',
          description: 'Writes documents',
        })
        .expect(200);

      expect(updated.body).toEqual(
        expect.objectContaining({
          id: created.id,
          name: 'writer',
          description: 'Writes documents',
        }),
      );

      await api().delete(`/api/admin/rbac/roles/${created.id}`).expect(204);

      expect(roleByName('writer')).toBeUndefined();
    });

    it('stores a null description when none is given', async () => {
      const created = await createRole('bare');

      expect(created.description).toBeNull();
    });

    it('keeps the name when an update only touches the description', async () => {
      const created = await createRole('editor');

      const res = await api()
        .put(`/api/admin/rbac/roles/${created.id}`, {
          name: 'editor',
          description: 'Same name',
        })
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({ name: 'editor', description: 'Same name' }),
      );

      const empty = await api()
        .put(`/api/admin/rbac/roles/${created.id}`, {})
        .expect(200);

      expect(empty.body.description).toBe('Same name');
    });

    it('rejects a duplicate role name with 409', async () => {
      await api().post('/api/admin/rbac/roles', { name: 'admin' }).expect(409);

      const editor = await createRole('editor');

      await api()
        .put(`/api/admin/rbac/roles/${editor.id}`, { name: 'admin' })
        .expect(409);
    });

    it('refuses to delete a role that still has grants or assignments (409)', async () => {
      await api()
        .delete(`/api/admin/rbac/roles/${roleByName('admin').id}`)
        .expect(409);

      await t.seedUser({ roles: ['auditor'] });
      await api()
        .delete(`/api/admin/rbac/roles/${roleByName('auditor').id}`)
        .expect(409);

      expect(roleByName('admin')).toBeDefined();
      expect(roleByName('auditor')).toBeDefined();
    });

    it('returns 404 for an unknown role', async () => {
      await api()
        .put(`/api/admin/rbac/roles/${MISSING_ID}`, { name: 'x' })
        .expect(404);
      await api().delete(`/api/admin/rbac/roles/${MISSING_ID}`).expect(404);
    });

    it.each([
      ['missing name', {}],
      ['empty name', { name: '' }],
      ['name with forbidden characters', { name: 'bad name!' }],
      ['name too long', { name: 'a'.repeat(101) }],
      ['non-string description', { name: 'ok', description: 5 }],
      ['description too long', { name: 'ok', description: 'd'.repeat(256) }],
    ])('rejects a create with %s (400)', async (_label, body) => {
      await api().post('/api/admin/rbac/roles', body).expect(400);
    });

    it('rejects a non-uuid role id (400)', async () => {
      await api().put('/api/admin/rbac/roles/not-a-uuid', {}).expect(400);
      await api().delete('/api/admin/rbac/roles/not-a-uuid').expect(400);
    });
  });

  describe('permissions', () => {
    it('lists permissions ordered by name', async () => {
      const res = await api().get('/api/admin/rbac/permissions').expect(200);

      expect(res.body).toEqual([
        expect.objectContaining({
          name: 'rbac',
          actions: ['read', 'create', 'update', 'delete'],
        }),
        expect.objectContaining({ name: 'transformations.history' }),
        expect.objectContaining({ name: 'users' }),
      ]);
    });

    it('creates, updates and deletes a permission', async () => {
      const created = await createPermission('documents', ['read', 'write']);

      expect(created).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: 'documents',
          actions: ['read', 'write'],
        }),
      );

      const updated = await api()
        .put(`/api/admin/rbac/permissions/${created.id}`, {
          name: 'docs',
          actions: ['read'],
        })
        .expect(200);

      expect(updated.body).toEqual(
        expect.objectContaining({ name: 'docs', actions: ['read'] }),
      );

      await api()
        .delete(`/api/admin/rbac/permissions/${created.id}`)
        .expect(204);

      expect(permissionByName('docs')).toBeUndefined();
    });

    it('defaults actions to an empty list', async () => {
      const created = await createPermission('reports');

      expect(created.actions).toEqual([]);
    });

    it('rejects a duplicate permission name with 409', async () => {
      await api()
        .post('/api/admin/rbac/permissions', { name: 'rbac' })
        .expect(409);

      const docs = await createPermission('documents');

      await api()
        .put(`/api/admin/rbac/permissions/${docs.id}`, { name: 'rbac' })
        .expect(409);
      await api()
        .put(`/api/admin/rbac/permissions/${docs.id}`, { name: 'documents' })
        .expect(200);
    });

    it('refuses to drop actions still used by a grant (409)', async () => {
      const docs = await createPermission('documents', ['read', 'write']);
      const role = await createRole('editor');

      await createGrant({
        roleId: role.id,
        permissionId: docs.id,
        actions: ['write'],
      });

      const res = await api()
        .put(`/api/admin/rbac/permissions/${docs.id}`, { actions: ['read'] })
        .expect(409);

      expect(res.body.message).toContain('write');

      await api()
        .put(`/api/admin/rbac/permissions/${docs.id}`, {
          actions: ['write', 'publish'],
        })
        .expect(200);
      await api()
        .put(`/api/admin/rbac/permissions/${docs.id}`, { actions: [] })
        .expect(200);
    });

    it('allows dropping actions when grants cover the whole permission', async () => {
      const docs = await createPermission('documents', ['read', 'write']);
      const role = await createRole('editor');

      await createGrant({ roleId: role.id, permissionId: docs.id });

      await api()
        .put(`/api/admin/rbac/permissions/${docs.id}`, { actions: ['read'] })
        .expect(200);
    });

    it('refuses to delete a permission referenced by a grant (409)', async () => {
      await api()
        .delete(`/api/admin/rbac/permissions/${permissionByName('rbac').id}`)
        .expect(409);

      expect(permissionByName('rbac')).toBeDefined();
    });

    it('returns 404 for an unknown permission', async () => {
      await api()
        .put(`/api/admin/rbac/permissions/${MISSING_ID}`, { name: 'x' })
        .expect(404);
      await api()
        .delete(`/api/admin/rbac/permissions/${MISSING_ID}`)
        .expect(404);
    });

    it.each([
      ['missing name', {}],
      ['name with forbidden characters', { name: 'a b' }],
      ['actions not an array', { name: 'ok', actions: 'read' }],
      ['duplicate actions', { name: 'ok', actions: ['read', 'read'] }],
      ['invalid action', { name: 'ok', actions: ['re ad'] }],
      ['non-string action', { name: 'ok', actions: [1] }],
    ])('rejects a create with %s (400)', async (_label, body) => {
      await api().post('/api/admin/rbac/permissions', body).expect(400);
    });
  });

  describe('grants', () => {
    let role: any;
    let docs: any;

    beforeEach(async () => {
      role = await createRole('editor');
      docs = await createPermission('documents', ['read', 'write', 'delete']);
    });

    it('lists grants with role and permission names', async () => {
      await createGrant({ roleId: role.id, permissionId: docs.id });

      const res = await api().get('/api/admin/rbac/grants').expect(200);

      expect(
        res.body.map((grant: any) => [grant.roleName, grant.permissionName]),
      ).toEqual([
        ['admin', 'rbac'],
        ['admin', 'transformations.history'],
        ['admin', 'users'],
        ['editor', 'documents'],
      ]);
    });

    it('creates a grant with an action subset, updates and deletes it', async () => {
      const created = await createGrant({
        roleId: role.id,
        permissionId: docs.id,
        actions: ['read'],
      });

      expect(created).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          roleId: role.id,
          roleName: 'editor',
          permissionId: docs.id,
          permissionName: 'documents',
          actions: ['read'],
        }),
      );

      const updated = await api()
        .put(`/api/admin/rbac/grants/${created.id}`, {
          actions: ['read', 'write'],
        })
        .expect(200);

      expect(updated.body.actions).toEqual(['read', 'write']);

      const whole = await api()
        .put(`/api/admin/rbac/grants/${created.id}`, { actions: [] })
        .expect(200);

      expect(whole.body.actions).toBeNull();

      await api().delete(`/api/admin/rbac/grants/${created.id}`).expect(204);

      expect(
        t
          .repo(Grant)
          .all()
          .some((g) => g.id === created.id),
      ).toBe(false);
    });

    it('stores null actions when the grant covers the whole permission', async () => {
      const created = await createGrant({
        roleId: role.id,
        permissionId: docs.id,
      });

      expect(created.actions).toBeNull();
    });

    it('moves a grant to another role and permission', async () => {
      const other = await createRole('reviewer');
      const reports = await createPermission('reports', ['read']);
      const grant = await createGrant({
        roleId: role.id,
        permissionId: docs.id,
        actions: ['read'],
      });

      const res = await api()
        .put(`/api/admin/rbac/grants/${grant.id}`, {
          roleId: other.id,
          permissionId: reports.id,
        })
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          roleName: 'reviewer',
          permissionName: 'reports',
          actions: ['read'],
        }),
      );
    });

    it('re-validates kept actions against a new permission (400)', async () => {
      const reports = await createPermission('reports', ['view']);
      const grant = await createGrant({
        roleId: role.id,
        permissionId: docs.id,
        actions: ['write'],
      });

      await api()
        .put(`/api/admin/rbac/grants/${grant.id}`, {
          permissionId: reports.id,
        })
        .expect(400);
    });

    it('rejects a duplicate role+permission grant with 409', async () => {
      await createGrant({ roleId: role.id, permissionId: docs.id });

      await api()
        .post('/api/admin/rbac/grants', {
          roleId: role.id,
          permissionId: docs.id,
        })
        .expect(409);

      const reports = await createPermission('reports');
      const second = await createGrant({
        roleId: role.id,
        permissionId: reports.id,
      });

      await api()
        .put(`/api/admin/rbac/grants/${second.id}`, { permissionId: docs.id })
        .expect(409);
    });

    it('returns 404 when the role, the permission or the grant does not exist', async () => {
      const unknownRole = await api()
        .post('/api/admin/rbac/grants', {
          roleId: MISSING_ID,
          permissionId: docs.id,
        })
        .expect(404);

      expect(unknownRole.body.message).toBe('Role not found');

      const unknownPermission = await api()
        .post('/api/admin/rbac/grants', {
          roleId: role.id,
          permissionId: MISSING_ID,
        })
        .expect(404);

      expect(unknownPermission.body.message).toBe('Permission not found');

      await api()
        .put(`/api/admin/rbac/grants/${MISSING_ID}`, { actions: [] })
        .expect(404);
      await api().delete(`/api/admin/rbac/grants/${MISSING_ID}`).expect(404);
    });

    it('rejects actions the permission does not declare (400)', async () => {
      const res = await api()
        .post('/api/admin/rbac/grants', {
          roleId: role.id,
          permissionId: docs.id,
          actions: ['read', 'publish'],
        })
        .expect(400);

      expect(res.body.message).toContain('publish');

      const reports = await createPermission('reports');

      await api()
        .post('/api/admin/rbac/grants', {
          roleId: role.id,
          permissionId: reports.id,
          actions: ['read'],
        })
        .expect(400);
    });

    it.each([
      ['missing ids', {}],
      ['non-uuid roleId', { roleId: 'x', permissionId: MISSING_ID }],
      ['non-uuid permissionId', { roleId: MISSING_ID, permissionId: 'x' }],
      [
        'actions not an array',
        { roleId: MISSING_ID, permissionId: MISSING_ID, actions: 'read' },
      ],
    ])('rejects a create with %s (400)', async (_label, body) => {
      await api().post('/api/admin/rbac/grants', body).expect(400);
    });
  });

  describe('user roles', () => {
    let target: User;
    let role: any;

    beforeEach(async () => {
      target = await t.seedUser();
      role = await createRole('editor');
    });

    const url = (userId: string, roleId?: string) =>
      `/api/admin/rbac/users/${userId}/roles${roleId ? `/${roleId}` : ''}`;

    it('assigns, lists and revokes a role', async () => {
      const assigned = await api()
        .post(url(target.id), { roleId: role.id })
        .expect(201);

      expect(assigned.body).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          userId: target.id,
          roleId: role.id,
          roleName: 'editor',
        }),
      );

      await t.assignRole(target.id, 'auditor');

      const listed = await api().get(url(target.id)).expect(200);

      expect(listed.body.map((ur: any) => ur.roleName)).toEqual([
        'auditor',
        'editor',
      ]);

      await api().delete(url(target.id, role.id)).expect(204);

      expect(
        t
          .repo(UserRole)
          .all()
          .some((ur) => ur.userId === target.id && ur.roleId === role.id),
      ).toBe(false);
    });

    it('rejects assigning the same role twice with 409', async () => {
      await api().post(url(target.id), { roleId: role.id }).expect(201);
      await api().post(url(target.id), { roleId: role.id }).expect(409);
    });

    it('returns 404 for an unknown user, role or assignment', async () => {
      await api().get(url(MISSING_ID)).expect(404);

      const noUser = await api()
        .post(url(MISSING_ID), { roleId: role.id })
        .expect(404);

      expect(noUser.body.message).toBe('User not found');

      const noRole = await api()
        .post(url(target.id), { roleId: MISSING_ID })
        .expect(404);

      expect(noRole.body.message).toBe('Role not found');

      await api().delete(url(target.id, role.id)).expect(404);
    });

    it('validates the body and path parameters (400)', async () => {
      await api().post(url(target.id), {}).expect(400);
      await api().post(url(target.id), { roleId: 'nope' }).expect(400);
      await api().get(url('not-a-uuid')).expect(400);
      await api().delete(url(target.id, 'not-a-uuid')).expect(400);
    });
  });

  describe('authentication and authorization', () => {
    const endpoints: [string, string][] = [
      ['get', '/api/admin/rbac/roles'],
      ['post', '/api/admin/rbac/roles'],
      ['put', `/api/admin/rbac/roles/${MISSING_ID}`],
      ['delete', `/api/admin/rbac/roles/${MISSING_ID}`],
      ['get', '/api/admin/rbac/permissions'],
      ['post', '/api/admin/rbac/permissions'],
      ['put', `/api/admin/rbac/permissions/${MISSING_ID}`],
      ['delete', `/api/admin/rbac/permissions/${MISSING_ID}`],
      ['get', '/api/admin/rbac/grants'],
      ['post', '/api/admin/rbac/grants'],
      ['put', `/api/admin/rbac/grants/${MISSING_ID}`],
      ['delete', `/api/admin/rbac/grants/${MISSING_ID}`],
      ['get', `/api/admin/rbac/users/${MISSING_ID}/roles`],
      ['post', `/api/admin/rbac/users/${MISSING_ID}/roles`],
      ['delete', `/api/admin/rbac/users/${MISSING_ID}/roles/${MISSING_ID}`],
    ];

    const send = (method: string, url: string, cookie?: string) => {
      const req = (t.http() as any)[method](url);

      return cookie ? req.set('Cookie', cookie) : req;
    };

    describe.each(endpoints)('%s %s', (method, url) => {
      it('returns 401 without a cookie', async () => {
        await send(method, url).expect(401);
      });

      it('returns 401 with an invalid token', async () => {
        await send(method, url, 'access_token=not-a-jwt').expect(401);
      });

      it('returns 401 when the refresh token is used as access token', async () => {
        await send(method, url, `access_token=${t.refreshToken(admin)}`).expect(
          401,
        );
      });

      it('returns 403 for a user without the rbac permission', async () => {
        const user = await t.seedUser({ roles: ['user'] });

        await send(method, url, t.authCookie(user)).expect(403);
      });
    });

    it('checks the action: rbac@read alone does not allow mutations', async () => {
      const reader = await t.seedUser({ permissions: ['rbac@read'] });
      const reader$ = as(t.authCookie(reader));

      await reader$.get('/api/admin/rbac/roles').expect(200);
      await reader$.post('/api/admin/rbac/roles', { name: 'x' }).expect(403);
      await reader$.delete(`/api/admin/rbac/grants/${MISSING_ID}`).expect(403);
    });

    it('rejects a mutation by a non-admin before touching the database', async () => {
      const user = await t.seedUser();

      await as(t.authCookie(user))
        .post('/api/admin/rbac/roles', { name: 'sneaky' })
        .expect(403);

      expect(roleByName('sneaky')).toBeUndefined();
    });
  });

  describe('cache invalidation', () => {
    let clock: FakeClock;

    beforeEach(() => {
      clock = useFakeClock();
    });

    afterEach(() => clock.restore());

    it('applies a permission granted through the API on the next request', async () => {
      const user = await t.seedUser();
      const user$ = as(t.authCookie(user));

      await user$.get('/api/admin/rbac/roles').expect(403);

      const role = await createRole('rbac-reader');

      await createGrant({
        roleId: role.id,
        permissionId: permissionByName('rbac').id,
        actions: ['read'],
      });
      await api()
        .post(`/api/admin/rbac/users/${user.id}/roles`, { roleId: role.id })
        .expect(201);

      await user$.get('/api/admin/rbac/roles').expect(200);
      await user$.post('/api/admin/rbac/roles', { name: 'x' }).expect(403);

      const grant = t
        .repo(Grant)
        .all()
        .find((g) => g.roleId === role.id)!;

      await api()
        .put(`/api/admin/rbac/grants/${grant.id}`, {
          actions: ['read', 'create'],
        })
        .expect(200);
      await user$.post('/api/admin/rbac/roles', { name: 'x' }).expect(201);
    });

    it('applies a revocation through the API on the next request', async () => {
      const user = await t.seedUser({ roles: ['admin'] });
      const user$ = as(t.authCookie(user));

      await user$.get('/api/admin/rbac/roles').expect(200);

      await api()
        .delete(
          `/api/admin/rbac/users/${user.id}/roles/${roleByName('admin').id}`,
        )
        .expect(204);

      await user$.get('/api/admin/rbac/roles').expect(403);
    });

    it('serves a direct DB change only after the TTL, proving the cache is used', async () => {
      const user = await t.seedUser();
      const user$ = as(t.authCookie(user));

      await user$.get('/api/admin/rbac/roles').expect(403);

      t.repo(UserRole).seed({
        userId: user.id,
        roleId: roleByName('admin').id,
      });

      await user$.get('/api/admin/rbac/roles').expect(403);

      clock.advance(30_000);

      await user$.get('/api/admin/rbac/roles').expect(200);
    });
  });
});
