/**
 * usePermissions — Permission checking hook.
 * Computes the user's effective permissions from their roles.
 */
import { useMemo } from 'react';
import { P } from '../constants';

interface Role {
  id: string;
  name: string;
  permissions: number;
  position: number;
  color?: string;
}

export function usePermissions(
  allRoles: Role[],
  memberRoles: Role[],
  isOwner: boolean,
) {
  const perms = useMemo(() => {
    if (isOwner) return Number.MAX_SAFE_INTEGER; // Owner bypasses all
    let bits = 0;
    // @everyone role
    const everyone = allRoles.find(r => r.name === '@everyone');
    if (everyone) bits |= everyone.permissions;
    // Assigned roles
    memberRoles.forEach(r => { bits |= r.permissions; });
    return bits;
  }, [allRoles, memberRoles, isOwner]);

  const hasPerm = (bit: number): boolean => {
    if (isOwner) return true;
    if (perms & P.ADMIN) return true;
    return (perms & bit) !== 0;
  };

  return { perms, hasPerm };
}
