import { supabase } from "../config/supabase";

export const deleteExpiredOrderPhotos = async () => {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() - 15);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, photo_urls, created_at")
    .lt("created_at", expiryDate.toISOString())
    .not("photo_urls", "is", []);

  if (error) {
    console.error('Get error while get expired orders');
  }

  if (!orders || orders.length === 0) {
    console.log('No expire order found')
    return;
  }

  const failures: string[] = [];

  for (const order of orders) {
    const { data: files, error: listError } = await supabase.storage
      .from("orderPhotos")
      .list(order.id, { limit: 100 });

    if (listError) {
      console.error(`Failed to list photos for order ${order.id}:`, listError);
      failures.push(order.id);
      continue;
    }

    const photoPaths = (files ?? []).map(
      (file) => `${order.id}/${file.name}`,
    );

    if (photoPaths.length > 0) {
      const { error: deleteError } = await supabase.storage
        .from("orderPhotos")
        .remove(photoPaths);

      if (deleteError) {
        console.error(
          `Failed to delete photos for order ${order.id}:`,
          deleteError,
        );
        failures.push(order.id);
        continue;
      }
    }

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        photo_urls: [],
      })
      .eq("id", order.id);

    if (updateError) {
      console.error(
        `Photos deleted but DB update failed for order ${order.id}:`,
        updateError,
      );
      failures.push(order.id);
    }
  }

  if (failures.length > 0) {
    console.error(`Photo cleanup failed for ${failures.length} order(s)`);
  }

  console.log(`Photo cleanup done on : ${new Date().getDate()}`)
};