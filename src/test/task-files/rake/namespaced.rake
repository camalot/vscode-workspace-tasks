namespace :db do
  desc "Migrate database"
  task :migrate do
    puts "migrate"
  end
end

namespace :assets do
  task :clean do
    puts "clean"
  end
end
