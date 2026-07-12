require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'EyeGoLiveActivity'
  s.version        = package['version']
  s.summary        = package['description']
  s.author         = 'EyeGo'
  s.homepage       = 'https://eyego.example'
  s.platforms      = { ios: '16.2' } # ActivityKit minimum
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
end
