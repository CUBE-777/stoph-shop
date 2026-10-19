import { createContext, useContext } from 'react';
// { perms: string[], can: (key) => boolean, userId: string }
export const AdminContext = createContext({ perms: [], can: () => false, userId: null });
export const useAdmin = () => useContext(AdminContext);
