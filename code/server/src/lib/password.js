import bcrypt from 'bcrypt';

const ROUNDS = 10; // chi phí băm: càng cao càng chậm (cũng chậm với kẻ dò mật khẩu)

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
