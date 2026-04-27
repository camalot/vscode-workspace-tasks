desc "Task with multiline dependency list"
task :release,
     [:version, :environment] do |_t, args|
  puts args[:version]
end
