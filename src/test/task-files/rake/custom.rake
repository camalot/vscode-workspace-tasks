# Custom rake file for testing
require 'rake'

desc "Custom task one"
task :custom_one do
  puts "Running custom task one"
end

desc "Custom task two"
task :custom_two do
  puts "Running custom task two"
end

namespace :admin do
  desc "Run admin cleanup"
  task :cleanup do
    puts "Running admin cleanup..."
  end
end
