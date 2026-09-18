import { supabase } from "../config/supabase";

export const isUserAdmin = async (userId: string): Promise<boolean> => {
    if(!userId) {return false};
  const { data: user, error } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return false;
  }

  return user.role === "admin";
};